/* ==========================================
   MONSE MEDIA | CLIENT.JS
   Private Client Portal
   Accounts, Contracts & Creative Galleries
   Requires: supabase.js
   ========================================== */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    const API = window.MonseAPI;
    const controller = new AbortController();
    const $ = id => document.getElementById(id);

    const token = new URLSearchParams(
        location.hash.slice(1)
    ).get("token") || "";

    const accountProjectId = new URLSearchParams(
        location.search
    ).get("project") || "";

    const accountMode = !token && !!accountProjectId;

    let base;
    let project = null;
    let busy = false;
    let expired = false;
    let leaving = false;


    /* ==========================================
       01 | PROJECT STATUS LABELS
       ========================================== */

    const labels = {

        pending: "AWAITING REVIEW",

        more_info: "MORE INFORMATION REQUESTED",

        approved: "PROJECT ACCEPTED",

        signed: "CONTRACT SIGNED",

        declined: "PROJECT NOT ACCEPTED",

        delivered: "YOUR GALLERY IS READY"

    };

    const descriptions = {

        pending:
            "Your inquiry has been received and is awaiting review. Thank you for considering Monse Media!",

        more_info:
            "I would love to learn more about your project. Please add further details and inspiration below.",

        approved:
            "Your project has been accepted! Please review and sign your personalized agreement.",

        signed:
            "Your contract has been signed. Your project is moving forward.",

        declined:
            "Unfortunately, I am unable to accept this project at this time. Thank you for considering Monse Media.",

        delivered:
            "Your completed collection is ready! You can view and download your finished files below."

    };


    /* ==========================================
       02 | DISPLAY HELPERS
       ========================================== */

    function text(id, value = "") {

        if ($(id)) {

            $(id).textContent = value ?? "";

        }

    }

    function feedback(id, value = "", error = false) {

        text(id, value);

        if ($(id)) {

            $(id).style.color =
                error ? "#ff8888" : "#e6c878";

        }

    }

    function show(id, visible) {

        const el = $(id);

        if (!el) return;

        el.hidden = !visible;

        el.classList.toggle("hidden", !visible);

        el.style.display = visible ? "" : "none";

    }


    /* ==========================================
       03 | PRIVATE CLIENT SECURITY
       ========================================== */

    function clearPrivate() {

        project = null;

        for (const id of [

            "dashboard",
            "contractText",
            "signForm",
            "contractDownload",
            "gallerySection"

        ]) {

            show(id, false);

        }

        for (const id of [

            "status",
            "summary",
            "contractText",
            "contractHint",
            "signStatus",
            "inspirationStatus"

        ]) {

            text(id);

        }

        for (const id of [

            "inspirationForm",
            "referenceForm",
            "signForm"

        ]) {

            $(id)?.reset();

        }

        $("gallery")?.replaceChildren();

    }


    /* ==========================================
       04 | SECURE SERVER CONNECTION
       ========================================== */

    /*
        Account login and registration are managed
        exclusively by auth.js.

        Private booking tokens are never stored
        in localStorage.
    */

    async function api(
        path,
        method = "GET",
        data,
        pdf = false
    ) {

        if (

            !base ||

            expired ||

            leaving ||

            (!token && !accountMode)

        ) {

            throw new Error(
                "Private booking access is unavailable."
            );

        }

        const url = new URL(path, base);

        if (

            url.origin !== base.origin ||

            !url.pathname.startsWith("/api/client/")

        ) {

            throw new Error(
                "Invalid server address."
            );

        }


        /* RETURNING CLIENT ACCOUNT ACCESS */

        if (accountMode) {

            url.searchParams.set(

                "project",

                accountProjectId

            );

        }


        /* PREPARE REQUEST HEADERS */

        const multipart = data instanceof FormData;

        const headers = {

            Accept: pdf

                ? "application/pdf"

                : "application/json"

        };


        /* ORIGINAL PRIVATE BOOKING LINK */

        if (!accountMode) {

            headers.Authorization = `Bearer ${token}`;

        }

        if (data !== undefined && !multipart) {

            headers["Content-Type"] = "application/json";

        }


        /* CONNECT TO SERVER */

        let response;

        try {

            response = await fetch(url, {

                method,

                headers,

                credentials: accountMode

                    ? "include"

                    : "omit",

                cache: "no-store",

                redirect: "error",

                referrerPolicy: "same-origin",

                signal: controller.signal,

                body:

                    data === undefined

                        ? undefined

                        : multipart

                        ? data

                        : JSON.stringify(data)

            });

        } catch {

            throw new Error(

                "Unable to connect to Monse Media. Please check your connection."

            );

        }

        if (leaving) {

            throw new Error("Page closed.");

        }

        const type =
            response.headers.get("content-type") || "";


        /* VERIFY PRIVATE PROJECT ACCESS */

        if ([401, 403].includes(response.status)) {

            expired = true;

            clearPrivate();

            throw new Error(

                "Your private access could not be verified. Please contact Monse Media for assistance."

            );

        }


        /* HANDLE SERVER ERRORS */

        if (!response.ok) {

            const result = type.includes("json")

                ? await response.json().catch(() => ({}))

                : {};

            throw new Error(

                typeof result?.error === "string"

                    ? result.error

                    : `Request failed (${response.status}).`

            );

        }


        /* DOWNLOAD CONTRACT PDF */

        if (pdf) {

            if (!type.includes("application/pdf")) {

                throw new Error(

                    "The agreement PDF is unavailable."

                );

            }

            return response.blob();

        }


        /* READ JSON RESPONSE */

        if (response.status === 204) return {};

        if (!type.includes("json")) {

            throw new Error(

                "Unexpected server response. Check the backend connection."

            );

        }

        return response.json();

    }


    /* ==========================================
       05 | PREVENT DUPLICATE SUBMISSIONS
       ========================================== */

    async function run(
        button,
        label,
        statusId,
        task
    ) {

        if (busy || expired || leaving) return;

        busy = true;

        const original = button?.textContent;

        const wasDisabled = button?.disabled;

        if (button) {

            button.disabled = true;

            button.textContent = label;

        }

        try {

            await task();

        } catch (error) {

            if (!leaving) {

                feedback(

                    expired ? "message" : statusId,

                    error.message,

                    true

                );

            }

        } finally {

            busy = false;

            if (button) {

                button.disabled =

                    leaving ||

                    expired ||

                    Boolean(wasDisabled);

                button.textContent = original;

            }

        }

    }

    const submitButton = form =>

        $(form)?.querySelector('button[type="submit"]');


    /* ==========================================
       06 | PRIVATE GALLERY DOWNLOADS
       ========================================== */

    function privateURL(address) {

        return API.privateURL(address);

    }

    async function download(fileId) {

        if (

            !project?.published ||

            !project?.signed_at

        ) {

            throw new Error(

                "Your gallery is not available yet."

            );

        }

        const result = await api(

            "/api/client/download-link",

            "POST",

            { fileId }

        );

        location.assign(

            privateURL(result.url)

        );

    }


    /* FORMAT FILE SIZE */

    function fileSize(bytes) {

        if (bytes == null || bytes === "") return "";

        const n = Number(bytes);

        if (!Number.isFinite(n) || n < 0) return "";

        if (n < 1024) {

            return `${n} B`;

        }

        if (n < 1024 ** 2) {

            return `${(n / 1024).toFixed(1)} KB`;

        }

        if (n < 1024 ** 3) {

            return `${(n / 1024 ** 2).toFixed(1)} MB`;

        }

        return `${(n / 1024 ** 3).toFixed(2)} GB`;

    }


    /* ==========================================
       07 | DISPLAY PRIVATE CLIENT GALLERY
       ========================================== */

    function renderGallery(files) {

        const ready = Boolean(

            project.published && project.signed_at

        );

        show("gallerySection", ready);

        const gallery = $("gallery");

        gallery?.replaceChildren();

        if ($("downloadAll")) {

            $("downloadAll").disabled =

                !ready || !files.length;

        }

        if (!ready || !gallery) return;

        if (!files.length) {

            gallery.textContent =

                "Your gallery is being prepared.";

            return;

        }


        /* GENERATE INDIVIDUAL FILE CARDS */

        for (const file of files) {

            const card = document.createElement("div");

            card.className = "gallery-item";

            const filename =

                file.filename || "Creative file";


            /* FILE PLACEHOLDER */

            const placeholder =

                document.createElement("div");

            placeholder.className =

                "gallery-file-placeholder";

            placeholder.textContent =

                "MONSE MEDIA / FILE";

            card.append(placeholder);


            /* PRIVATE IMAGE PREVIEW */

            try {

                if (file.previewUrl) {

                    const img =

                        document.createElement("img");

                    img.alt = filename;

                    img.loading = "lazy";

                    img.referrerPolicy = "no-referrer";

                    img.className = "gallery-preview";

                    img.style.cssText =

                        "width:100%;" +

                        "height:220px;" +

                        "object-fit:cover;" +

                        "display:block";

                    img.addEventListener(

                        "error",

                        () => img.replaceWith(placeholder),

                        { once: true }

                    );

                    img.src = privateURL(file.previewUrl);

                    placeholder.replaceWith(img);

                }

            } catch {

                // Keep the placeholder if the preview
                // could not be verified.

            }


            /* FILE NAME */

            const name = document.createElement("p");

            name.className = "gallery-filename";

            name.textContent = filename;

            name.style.overflowWrap = "anywhere";


            /* FILE SIZE */

            const size = document.createElement("p");

            size.className = "muted small";

            size.textContent = fileSize(file.bytes);


            /* INDIVIDUAL DOWNLOAD BUTTON */

            const button =

                document.createElement("button");

            button.type = "button";

            button.className = "secondary";

            button.textContent = "DOWNLOAD FILE ↓";

            button.disabled = file.id == null;

            button.addEventListener(

                "click",

                () => run(

                    button,

                    "PREPARING...",

                    "message",

                    () => download(file.id)

                )

            );

            card.append(name, size, button);

            gallery.append(card);

        }

    }


    /* ==========================================
       08 | DISPLAY CLIENT PROJECT DETAILS
       ========================================== */

    function renderProject(result) {

        if (leaving || expired) return;

        if (

            !result?.project ||

            typeof result.project !== "object"

        ) {

            throw new Error(

                "Your booking could not be found."

            );

        }

        project = result.project;

        const status = project.status || "pending";


        /* DISPLAY CURRENT PROJECT STATUS */

        text(

            "status",

            Object.hasOwn(labels, status)

                ? labels[status]

                : String(status).toUpperCase()

        );


        /* DISPLAY PROJECT SUMMARY */

        text(

            "summary",

            [

                Object.hasOwn(descriptions, status)

                    ? descriptions[status]

                    : "Your project information is available.",

                project.event_type &&

                    `Project: ${project.event_type}`,

                project.event_date &&

                    `Date: ${project.event_date}`,

                project.event_location &&

                    `Location: ${project.event_location}`

            ].filter(Boolean).join("\n")

        );

        if ($("summary")) {

            $("summary").style.whiteSpace = "pre-line";

        }

        if ($("status")) {

            $("status").style.color =

                status === "declined"

                    ? "#ff8888"

                    : status === "delivered"

                    ? "#e6c878"

                    : "#d79ca6";

        }


        /* RESTORE SAVED CLIENT INSPIRATION */

        for (const [id, field] of [

            ["inspiration-details", "inspiration"],

            ["inspiration-pinterest", "pinterest"]

        ]) {

            if (

                $(id) &&

                document.activeElement !== $(id)

            ) {

                $(id).value = project[field] || "";

            }

        }


        /* ==========================================
           CONTRACT INFORMATION
           ========================================== */

        const hasContract = Boolean(

            project.contract_text

        );

        const signed = Boolean(

            project.signed_at

        );

        text(

            "contractHint",

            !hasContract

                ? "Your personalized agreement will appear once your project is approved."

                : signed

                ? "Your agreement has been signed. Download a copy below."

                : "Please review your agreement carefully before signing."

        );

        text(

            "contractText",

            project.contract_text || ""

        );

        show("contractText", hasContract);

        show("contractDownload", hasContract);

        show(

            "signForm",

            hasContract &&

            !signed &&

            status === "approved"

        );


        /* DISPLAY ELECTRONIC SIGNATURE */

        if (signed) {

            const date = new Date(project.signed_at);

            const when = Number.isNaN(date.getTime())

                ? "the recorded signing date"

                : date.toLocaleString();

            feedback(

                "signStatus",

                `Agreement signed by ${
                    project.signed_name || "client"
                } on ${when}.`

            );

            $("signForm")?.reset();

        } else {

            text("signStatus");

        }


        /* DISPLAY COMPLETED GALLERY */

        renderGallery(

            Array.isArray(result.files)

                ? result.files

                : []

        );

        show("dashboard", true);

        feedback("message");

    }


    /* LOAD CLIENT PROJECT FROM DATABASE */

    async function loadProject() {

        feedback(

            "message",

            "Loading your private booking..."

        );

        try {

            renderProject(

                await api("/api/client/project")

            );

        } catch (error) {

            clearPrivate();

            throw error;

        }

    }


    /* ==========================================
       09 | CLIENT INSPIRATION FORM
       ========================================== */

    $("inspirationForm")?.addEventListener(

        "submit",

        event => {

            event.preventDefault();

            if (

                !project ||

                busy ||

                leaving ||

                expired

            ) return;

            const inspiration =

                $("inspiration-details").value;

            const pinterest =

                $("inspiration-pinterest").value.trim();


            /* VALIDATE INSPIRATION DETAILS */

            if (inspiration.length > 6000) {

                return feedback(

                    "inspirationStatus",

                    "Use 6,000 characters or fewer.",

                    true

                );

            }


            /* VALIDATE PINTEREST LINK */

            if (pinterest) {

                try {

                    const u = new URL(pinterest);

                    if (

                        u.protocol !== "https:" ||

                        u.username ||

                        u.password

                    ) {

                        throw new Error();

                    }

                } catch {

                    return feedback(

                        "inspirationStatus",

                        "Enter a valid HTTPS inspiration link.",

                        true

                    );

                }

            }


            /* SAVE CLIENT CREATIVE VISION */

            void run(

                submitButton("inspirationForm"),

                "SAVING...",

                "inspirationStatus",

                async () => {

                    const result = await api(

                        "/api/client/inspiration",

                        "POST",

                        {

                            inspiration,

                            pinterest

                        }

                    );

                    if (result?.ok !== true) {

                        throw new Error(

                            "Your changes could not be confirmed."

                        );

                    }

                    feedback(

                        "inspirationStatus",

                        "Your creative vision has been saved!"

                    );

                }

            );

        }

    );


    /* ==========================================
       10 | UPLOAD CLIENT REFERENCE PHOTOGRAPHS
       ========================================== */

    $("referenceForm")?.addEventListener(

        "submit",

        event => {

            event.preventDefault();

            if (

                !project ||

                busy ||

                leaving ||

                expired

            ) return;

            const files = Array.from(

                $("reference-files")?.files || []

            );


            /* VALIDATE NUMBER OF IMAGES */

            if (!files.length || files.length > 12) {

                return feedback(

                    "inspirationStatus",

                    "Choose 1–12 images per upload.",

                    true

                );

            }


            /* VALIDATE FILE TYPE AND SIZE */

            if (files.some(f =>

                ![

                    "image/jpeg",

                    "image/png",

                    "image/webp"

                ].includes(f.type) ||

                !f.size ||

                f.size > 10 * 1024 * 1024

            )) {

                return feedback(

                    "inspirationStatus",

                    "Choose nonempty JPG, PNG or WebP images, up to 10 MB each.",

                    true

                );

            }

            const data = new FormData(

                event.currentTarget

            );


            /* UPLOAD CLIENT REFERENCES */

            void run(

                submitButton("referenceForm"),

                "UPLOADING...",

                "inspirationStatus",

                async () => {

                    const result = await api(

                        "/api/client/references",

                        "POST",

                        data

                    );

                    if (result?.ok !== true) {

                        throw new Error(

                            "Your upload could not be confirmed."

                        );

                    }

                    $("referenceForm").reset();

                    feedback(

                        "inspirationStatus",

                        "Your inspiration images have been uploaded."

                    );

                }

            );

        }

    );


    /* ==========================================
       11 | ELECTRONIC CONTRACT SIGNATURE
       ========================================== */

    $("signForm")?.addEventListener(

        "submit",

        event => {

            event.preventDefault();

            if (

                busy ||

                leaving ||

                expired ||

                !project?.contract_text ||

                project.signed_at ||

                project.status !== "approved"

            ) return;

            const signedName =

                $("signed-name").value.trim();

            const agree = event.currentTarget

                .querySelector('[name="agree"]')

                .checked;


            /* VERIFY SIGNATURE CONSENT */

            if (signedName.length < 3 || !agree) {

                return feedback(

                    "signStatus",

                    "Enter your full legal name and accept the agreement.",

                    true

                );

            }


            /* SAVE ELECTRONIC SIGNATURE */

            void run(

                submitButton("signForm"),

                "SIGNING...",

                "signStatus",

                async () => {

                    const result = await api(

                        "/api/client/sign",

                        "POST",

                        {

                            signedName,

                            agree: true

                        }

                    );

                    if (result?.ok !== true) {

                        throw new Error(

                            "Your signature could not be confirmed."

                        );

                    }

                    show("signForm", false);


                    /* REFRESH SIGNED AGREEMENT */

                    try {

                        await loadProject();

                    } catch (error) {

                        feedback(

                            "message",

                            "Signature submitted; unable to refresh your agreement. " +

                            error.message,

                            true

                        );

                    }

                }

            );

        }

    );


    /* ==========================================
       12 | DOWNLOAD PERSONALIZED CONTRACT PDF
       ========================================== */

    $("contractDownload")?.addEventListener(

        "click",

        () => {

            if (!project?.contract_text) return;

            void run(

                $("contractDownload"),

                "PREPARING PDF...",

                "signStatus",

                async () => {

                    const blob = await api(

                        "/api/client/contract",

                        "GET",

                        undefined,

                        true

                    );

                    const url = URL.createObjectURL(blob);

                    const a = document.createElement("a");

                    a.href = url;

                    a.download = "Monse-Media-Agreement.pdf";

                    document.body.append(a);

                    a.click();

                    a.remove();

                    setTimeout(

                        () => URL.revokeObjectURL(url),

                        30000

                    );

                }

            );

        }

    );


    /* ==========================================
       13 | DOWNLOAD COMPLETE COLLECTION
       ========================================== */

    $("downloadAll")?.addEventListener(

        "click",

        () => run(

            $("downloadAll"),

            "PREPARING COLLECTION...",

            "message",

            () => download("all")

        )

    );


    /* ==========================================
       14 | REFRESH PROJECT STATUS
       ========================================== */

    $("refresh")?.addEventListener(

        "click",

        () => run(

            $("refresh"),

            "REFRESHING...",

            "message",

            loadProject

        )

    );


    /* ==========================================
       15 | PRIVATE CLIENT DATA PROTECTION
       ========================================== */

    window.addEventListener(

        "hashchange",

        () => {

            const next = new URLSearchParams(

                location.hash.slice(1)

            ).get("token") || "";

            if (next !== token) {

                location.reload();

            }

        }

    );


    /* CLEAR PRIVATE DATA WHEN LEAVING */

    window.addEventListener(

        "pagehide",

        () => {

            leaving = true;

            controller.abort();

            clearPrivate();

        }

    );


    /* REVERIFY ACCESS AFTER BACK NAVIGATION */

    window.addEventListener(

        "pageshow",

        event => {

            if (event.persisted) {

                location.reload();

            }

        }

    );


    /* ==========================================
       16 | INITIALIZE PRIVATE CLIENT PORTAL
       ========================================== */

    clearPrivate();


    /* NO ACTIVE PROJECT SELECTED */

    if (!token && !accountMode) {

        feedback(

            "message",

            "For a previous booking, use your original private link or sign in above."

        );

        return;

    }


    /* VERIFY ORIGINAL PRIVATE BOOKING TOKEN */

    if (

        token &&

        !/^[A-Za-z0-9_-]{40,100}$/.test(token)

    ) {

        feedback(

            "message",

            "This booking link is invalid. Please use the original link.",

            true

        );

        return;

    }


    /* VERIFY BACKEND CONFIGURATION */

    try {

        if (!API?.isConfigured()) {

            throw new Error(

                "Open Monse Media through its Node.js server."

            );

        }

        base = new URL(location.origin);

    } catch (error) {

        feedback(

            "message",

            error.message,

            true

        );

        return;

    }


    /* LOAD VERIFIED CLIENT PROJECT */

    void run(

        null,

        "",

        "message",

        loadProject

    );

});


/* ==========================================
   END OF MONSE MEDIA CLIENT.JS
   ========================================== */