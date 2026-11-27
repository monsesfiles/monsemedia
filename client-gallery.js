/* ==========================================
   MONSE MEDIA | PRIVATE CLIENT GALLERY
   Filename: client-gallery.js
   ========================================== */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    /* 01 | SERVER CONFIGURATION */

    // Match the API_BASE in dashboard.js.

    const API_BASE = "";

    const $ = id => document.getElementById(id);

    const dialog = $("galleryLightbox");

    let base;
    let active = false;
    let busy = false;
    let generation = 0;

    let collections = [];
    let selected = null;
    let files = [];
    let visible = [];

    let filter = "all";
    let previewIndex = -1;
    let opener = null;


    /* ==========================================
       02 | DISPLAY HELPERS
       ========================================== */

    function text(id, value = "") {

        $(id).textContent = value ?? "";

    }

    function show(id, state) {

        $(id).hidden = !state;

    }

    function message(id, value = "", error = false) {

        text(id, value);

        $(id).classList.toggle("is-error", error);

    }

    function field(card, key, value) {

        const el = card.querySelector(
            `[data-field="${key}"]`
        );

        el.textContent = value ?? "";

        el.hidden = value == null || value === "";

    }

    const action = (card, key) =>

        card.querySelector(`[data-action="${key}"]`);


    const title = row =>

        row.event_type ||
        row.service ||
        "Creative collection";


    const ready = row =>

        row?.id != null &&

        row.published === true &&

        Boolean(row.signed_at);


    /* ==========================================
       03 | FORMAT SESSION DATES
       ========================================== */

    function formatDate(value) {

        if (!value) return "";

        const day = /^\d{4}-\d{2}-\d{2}$/.test(value);

        const date = new Date(
            day ? `${value}T00:00:00Z` : value
        );

        if (Number.isNaN(date.getTime())) return "";

        return date.toLocaleDateString("en-US", {

            month: "long",
            day: "numeric",
            year: "numeric",

            ...(day ? {timeZone: "UTC"} : {})

        });

    }


    /* ==========================================
       04 | FORMAT FILE SIZES
       ========================================== */

    function formatSize(bytes) {

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
       05 | CLEAR PRIVATE MEDIA
       ========================================== */

    function clearMedia() {

        const video = $("galleryLightboxVideo");

        video.pause();

        video.removeAttribute("src");

        video.load();

        $("galleryLightboxImage")
            .removeAttribute("src");


        for (const id of [

            "galleryLightboxImage",
            "galleryLightboxVideo",
            "galleryLightboxFallback"

        ]) {

            show(id, false);

        }

    }


    /* CLOSE FULL-SIZE PREVIEW */

    function closePreview(restore = true) {

        const previous = opener;

        opener = null;

        previewIndex = -1;

        clearMedia();


        if (dialog.open) {

            dialog.close();

        }


        document.body.classList.remove(

            "gallery-lightbox-open"

        );


        text("lightboxFilename");

        text("galleryLightboxCounter");

        message("galleryLightboxStatus");


        $("galleryLightboxDownload").disabled = true;


        if (restore && previous?.isConnected) {

            previous.focus();

        }

    }


    /* CLEAR SELECTED GALLERY */

    function clearGallery() {

        closePreview(false);

        selected = null;

        files = [];

        visible = [];

        filter = "all";


        $("galleryFiles").replaceChildren();


        for (const id of [

            "galleryTitle",
            "galleryDate",
            "galleryLocation",
            "galleryPublicationStatus",
            "galleryFileCount",
            "galleryPublishedDate",
            "galleryTotalSize",
            "visibleFileCount"

        ]) {

            text(id);

        }


        message("galleryDownloadStatus");

        $("downloadCollection").disabled = true;

        show("selectedGallery", false);

    }


    /* ==========================================
       06 | LOCK PRIVATE CLIENT WORKSPACE
       ========================================== */

    function lock(reason, error = false) {

        active = false;

        generation++;

        clearGallery();

        collections = [];


        $("collectionList").replaceChildren();

        $("collectionSearch").value = "";

        $("collectionSort").value = "newest";


        text("collectionCount", "— COLLECTIONS");

        text("galleryClientName");

        message("galleryMessage");


        show("galleryWorkspace", false);

        show("galleryAccess", true);


        message(

            "galleryAccessStatus",

            reason,

            error

        );

    }


    /* ==========================================
       07 | SERVER CONNECTION

       Server authorization is required for
       every private gallery and download.
       ========================================== */

    async function api(
        path,
        method = "GET",
        data
    ) {

        const requestGeneration = generation;

        const url = new URL(path, base);


        if (url.origin !== base.origin) {

            throw new Error("Invalid API address.");

        }


        const response = await fetch(url, {

            method,

            credentials: "include",

            cache: "no-store",

            redirect: "error",

            referrerPolicy: "no-referrer",

            headers: {

                Accept: "application/json",

                ...(data !== undefined

                    ? {"Content-Type": "application/json"}

                    : {})

            },

            body:

                data === undefined

                    ? undefined

                    : JSON.stringify(data)

        });


        if (requestGeneration !== generation) {

            throw new Error("Access changed.");

        }


        /* VERIFY ACCOUNT ACCESS */

        if ([401, 403].includes(response.status)) {

            lock(

                "Please sign in again to access your private collections.",

                true

            );

            throw new Error(

                "Account access could not be verified."

            );

        }


        /* CHECK SERVER RESPONSE */

        if (!response.ok) {

            throw new Error(

                `Request failed (${response.status}).`

            );

        }


        if (response.status === 204) {

            return {};

        }


        if (

            !(response.headers.get("content-type") || "")

                .includes("json")

        ) {

            throw new Error(

                "Unexpected server response. Check API configuration."

            );

        }


        const result = await response.json();


        if (requestGeneration !== generation) {

            throw new Error("Access changed.");

        }


        return result;

    }


    /* PRIVATE PROJECT API PATH */

    const projectPath = (id, suffix) =>

        `/api/client/account/projects/${encodeURIComponent(id)}${suffix}`;


    /* ==========================================
       08 | VALIDATE PRIVATE FILE ADDRESSES
       ========================================== */

    function privateURL(address) {

        if (

            typeof address !== "string" ||

            !address

        ) {

            throw new Error("Private file unavailable.");

        }


        const url = new URL(address, base);


        if (

            url.origin !== base.origin ||

            url.username ||

            url.password ||

            !url.pathname.startsWith("/api/access/")

        ) {

            throw new Error(

                "Invalid private file address."

            );

        }


        return url.href;

    }


    /* ==========================================
       09 | BUTTON LOADING STATES
       ========================================== */

    async function run(
        button,
        label,
        statusId,
        task
    ) {

        if (busy) return;

        busy = true;


        const original = button?.textContent;

        const disabled = button?.disabled;


        if (button) {

            button.disabled = true;

            button.textContent = label;

        }


        message(statusId);


        try {

            await task();

        } catch (error) {

            if (active) {

                message(

                    statusId,

                    error.message,

                    true

                );

            }

        } finally {

            busy = false;


            if (button) {

                button.textContent = original;

                button.disabled =

                    Boolean(disabled) || !active;

            }

        }

    }


    /* ==========================================
       10 | SECURE FILE DOWNLOADS

       Supports individual files and
       complete ZIP collections.
       ========================================== */

    function download(
        row,
        fileId,
        button,
        statusId
    ) {

        if (

            !active ||

            !ready(row) ||

            fileId == null

        ) return;


        void run(

            button,

            "PREPARING...",

            statusId,

            async () => {

                const result = await api(

                    projectPath(row.id, "/download-link"),

                    "POST",

                    {fileId}

                );


                if (active) {

                    location.assign(

                        privateURL(result.url)

                    );

                }

            }

        );

    }


    /* ==========================================
       11 | PRIVATE IMAGE THUMBNAILS
       ========================================== */

    function thumbnail(
        card,
        key,
        address,
        name
    ) {

        const image = card.querySelector(

            `[data-field="${key}"]`

        );


        const placeholder = card.querySelector(

            '[data-field="placeholder"]'

        );


        try {

            const src = privateURL(address);

            image.alt = name;


            /* RESTORE PLACEHOLDER IF IMAGE FAILS */

            image.addEventListener(

                "error",

                () => {

                    image.hidden = true;

                    image.removeAttribute("src");

                    placeholder.hidden = false;

                },

                {once: true}

            );


            image.hidden = false;

            placeholder.hidden = true;

            image.src = src;


        } catch {

            // Keep the placeholder when no
            // authorized preview exists.

        }

    }


    /* ==========================================
       12 | CREATE CLIENT COLLECTION CARDS
       ========================================== */

    function collectionCard(row) {

        const card = $("collectionCardTemplate")

            .content.cloneNode(true);


        field(card, "status", "PUBLISHED");

        field(card, "title", title(row));


        field(

            card,

            "date",

            formatDate(

                row.appointment?.date ||

                row.event_date

            )

        );


        field(

            card,

            "fileCount",

            Number.isInteger(row.fileCount)

                ? `${row.fileCount} file(s)`

                : ""

        );


        thumbnail(

            card,

            "cover",

            row.coverUrl,

            title(row)

        );


        /* COLLECTION ACTION BUTTONS */

        const open = action(card, "open");

        const zip = action(card, "download");


        open.disabled = false;

        zip.disabled = row.fileCount === 0;


        /* OPEN COLLECTION */

        open.addEventListener("click", () => {

            if (!active || busy) return;


            void run(

                open,

                "OPENING...",

                "galleryMessage",

                () => openGallery(row.id)

            );

        });


        /* DOWNLOAD COLLECTION */

        zip.addEventListener("click", () =>

            download(

                row,

                "all",

                zip,

                "galleryMessage"

            )

        );


        return card;

    }


    /* ==========================================
       13 | SEARCH AND SORT COLLECTIONS
       ========================================== */

    function renderCollections() {

        if (!active) return;


        const query = $("collectionSearch")

            .value.trim().toLowerCase();


        const order = $("collectionSort").value;


        const dateKey = row =>

            row.appointment?.date ||

            row.event_date ||

            "";


        /* SEARCH BY SESSION OR SERVICE */

        const rows = collections.filter(row =>

            `${title(row)} ${row.service || ""}`

                .toLowerCase()

                .includes(query)

        );


        /* SORT BY DATE OR NAME */

        rows.sort((a, b) =>

            order === "name"

                ? title(a).localeCompare(title(b))

                : order === "oldest"

                    ? dateKey(a).localeCompare(dateKey(b))

                    : dateKey(b).localeCompare(dateKey(a))

        );


        /* DISPLAY MATCHING COLLECTIONS */

        $("collectionList").replaceChildren(

            ...rows.map(collectionCard)

        );


        text(

            "collectionCount",

            `${rows.length} OF ${collections.length} COLLECTIONS`

        );


        show(

            "collectionsEmpty",

            collections.length === 0

        );


        show(

            "collectionSearchEmpty",

            collections.length > 0 &&

            rows.length === 0

        );

    }


    /* ==========================================
       14 | LOAD VERIFIED CLIENT COLLECTIONS
       ========================================== */

    async function loadCollections() {

        const data = await api(

            "/api/client/account/galleries"

        );


        /* VERIFY SERVER RESPONSE */

        if (

            data?.authenticated !== true ||

            !data.profile?.id ||

            !Array.isArray(data.collections)

        ) {

            throw new Error(

                "Your account or collections could not be verified."

            );

        }


        /* ONLY DISPLAY PUBLISHED COLLECTIONS */

        collections = data.collections.filter(ready);


        text(

            "galleryClientName",

            data.profile.first_name ||

            data.profile.name ||

            ""

        );


        active = true;

        renderCollections();


        show("galleryAccess", false);

        show("galleryWorkspace", true);

    }


    /* ==========================================
       15 | IDENTIFY MEDIA FILE TYPES
       ========================================== */

    function fileType(file) {

        const mime = String(

            file.mimeType ||

            file.mime_type ||

            ""

        ).toLowerCase();


        const name = String(

            file.filename || ""

        ).toLowerCase();


        /* PHOTOGRAPHY */

        if (

            mime.startsWith("image/") ||

            /\.(jpe?g|png|webp|gif|avif|heic)$/.test(name)

        ) {

            return "image";

        }


        /* VIDEOGRAPHY */

        if (

            mime.startsWith("video/") ||

            /\.(mp4|mov|webm|m4v)$/.test(name)

        ) {

            return "video";

        }


        /* DOCUMENTS */

        if (

            mime === "application/pdf" ||

            /\.(pdf|docx?|txt)$/.test(name)

        ) {

            return "document";

        }


        return "other";

    }


    const typeLabels = {

        image: "PHOTOGRAPHY",

        video: "VIDEOGRAPHY",

        document: "DOCUMENT",

        other: "CREATIVE FILE"

    };


    /* ==========================================
       16 | CREATE INDIVIDUAL GALLERY FILE CARDS
       ========================================== */

    function fileCard(file, index) {

        const card = $("galleryFileTemplate")

            .content.cloneNode(true);


        const name =

            file.filename || "Creative file";


        /* FILE INFORMATION */

        field(card, "filename", name);

        field(card, "type", typeLabels[fileType(file)]);

        field(card, "size", formatSize(file.bytes));


        /* FILE THUMBNAIL */

        thumbnail(

            card,

            "thumbnail",

            file.thumbnailUrl ||

            (

                fileType(file) === "image"

                    ? file.previewUrl

                    : null

            ),

            name

        );


        /* OPEN FULL-SIZE PREVIEW */

        const preview = action(card, "preview");

        preview.disabled = false;


        preview.setAttribute(

            "aria-label",

            `Preview ${name}`

        );


        preview.addEventListener(

            "click",

            () => openPreview(index, preview)

        );


        /* DOWNLOAD INDIVIDUAL FILE */

        const button = action(card, "download");

        button.disabled = false;


        button.addEventListener(

            "click",

            () => download(

                selected,

                file.id,

                button,

                "galleryDownloadStatus"

            )

        );


        return card;

    }


    /* ==========================================
       17 | RENDER FILTERED GALLERY FILES
       ========================================== */

    function renderFiles() {

        closePreview(false);


        visible = files.filter(file =>

            filter === "all" ||

            fileType(file) === filter

        );


        $("galleryFiles").replaceChildren(

            ...visible.map(fileCard)

        );


        text(

            "visibleFileCount",

            `${visible.length} OF ${files.length} FILES`

        );


        show(

            "galleryFilesEmpty",

            visible.length === 0

        );


        /* UPDATE ACTIVE FILTER */

        document.querySelectorAll(".gallery-filter")

            .forEach(button => {

                const isActive =

                    button.dataset.filter === filter;


                button.classList.toggle(

                    "active",

                    isActive

                );


                button.setAttribute(

                    "aria-pressed",

                    String(isActive)

                );

            });

    }


    /* ==========================================
       18 | COLLECTION URL NAVIGATION

       Allows dashboard gallery links to
       open the correct client collection.
       ========================================== */

    function setProjectQuery(id) {

        const url = new URL(location.href);


        if (id == null) {

            url.searchParams.delete("project");

        } else {

            url.searchParams.set(

                "project",

                String(id)

            );

        }


        history.replaceState(null, "", url);

    }


    /* RETURN TO ALL COLLECTIONS */

    function backToCollections() {

        clearGallery();

        setProjectQuery(null);

        show("collectionsSection", true);


        $("collectionsSection").scrollIntoView({

            block: "start"

        });

    }


    /* ==========================================
       19 | OPEN PRIVATE CLIENT COLLECTION
       ========================================== */

    async function openGallery(id) {

        if (

            !active ||

            !collections.some(row =>

                String(row.id) === String(id)

            )

        ) return;


        const data = await api(

            projectPath(id, "/gallery")

        );


        if (!active) return;


        /* VERIFY REQUESTED COLLECTION */

        if (

            !ready(data?.project) ||

            String(data.project.id) !== String(id) ||

            !Array.isArray(data.files)

        ) {

            throw new Error(

                "This collection is not available."

            );

        }


        clearGallery();

        selected = data.project;


        files = data.files.filter(file =>

            file && file.id != null

        );


        /* COLLECTION TITLE */

        text(

            "galleryTitle",

            title(selected)

        );


        /* SESSION DATE */

        text(

            "galleryDate",

            formatDate(

                selected.appointment?.date ||

                selected.event_date

            )

        );


        /* SESSION LOCATION */

        text(

            "galleryLocation",

            selected.appointment?.location ||

            selected.event_location ||

            ""

        );


        /* PUBLICATION STATUS */

        text(

            "galleryPublicationStatus",

            "PUBLISHED"

        );


        /* FILE COUNT */

        text(

            "galleryFileCount",

            String(files.length)

        );


        /* PUBLICATION DATE */

        text(

            "galleryPublishedDate",

            formatDate(selected.published_at) || "—"

        );


        /* TOTAL COLLECTION SIZE */

        const sizesKnown = files.every(f =>

            f.bytes != null &&

            f.bytes !== "" &&

            Number.isFinite(Number(f.bytes)) &&

            Number(f.bytes) >= 0

        );


        text(

            "galleryTotalSize",

            sizesKnown

                ? formatSize(

                    files.reduce(

                        (sum, f) =>

                            sum + Number(f.bytes),

                        0

                    )

                )

                : "—"

        );


        /* ENABLE COLLECTION DOWNLOAD */

        $("downloadCollection").disabled =

            !files.length;


        renderFiles();


        show("collectionsSection", false);

        show("selectedGallery", true);


        setProjectQuery(id);


        $("selectedGallery").scrollIntoView({

            block: "start"

        });


        $("galleryTitle").tabIndex = -1;


        $("galleryTitle").focus({

            preventScroll: true

        });

    }


    /* ==========================================
       20 | FULL-SIZE PHOTO AND VIDEO LIGHTBOX

       Photographs are centered using
       client-gallery.css.
       ========================================== */

    function renderPreview() {

        const file = visible[previewIndex];

        if (!file) return;


        clearMedia();

        message("galleryLightboxStatus");


        /* DISPLAY FILE NAME */

        text(

            "lightboxFilename",

            file.filename || "Creative file"

        );


        /* DISPLAY IMAGE COUNTER */

        text(

            "galleryLightboxCounter",

            `${previewIndex + 1} / ${visible.length}`

        );


        /* PREVIOUS AND NEXT BUTTONS */

        $("galleryLightboxPrevious").disabled =

            previewIndex === 0;


        $("galleryLightboxNext").disabled =

            previewIndex === visible.length - 1;


        $("galleryLightboxDownload").disabled = false;


        const kind = fileType(file);


        try {

            const src = privateURL(

                file.fullPreviewUrl ||

                file.previewUrl

            );


            /* DISPLAY PHOTOGRAPH */

            if (kind === "image") {

                const image = $("galleryLightboxImage");

                image.alt =

                    file.filename || "Client photograph";


                show("galleryLightboxImage", true);

                image.src = src;

            }


            /* DISPLAY VIDEO */

            else if (kind === "video") {

                show("galleryLightboxVideo", true);

                $("galleryLightboxVideo").src = src;

            }


            /* OTHER FILE TYPES */

            else {

                show("galleryLightboxFallback", true);

            }


        } catch {

            show("galleryLightboxFallback", true);

        }

    }


    /* ==========================================
       21 | OPEN CENTERED MEDIA PREVIEW
       ========================================== */

    function openPreview(index, button) {

        if (

            !active ||

            !selected ||

            !visible[index]

        ) return;


        opener = button;

        previewIndex = index;


        renderPreview();


        if (!dialog.open) {

            dialog.showModal();

        }


        document.body.classList.add(

            "gallery-lightbox-open"

        );


        $("galleryLightboxClose").focus();

    }


    /* PREVIOUS AND NEXT FILES */

    function step(direction) {

        const index = previewIndex + direction;


        if (

            !dialog.open ||

            index < 0 ||

            index >= visible.length

        ) return;


        previewIndex = index;

        renderPreview();

    }


    /* HANDLE UNAVAILABLE MEDIA */

    for (const [id, kind] of [

        ["galleryLightboxImage", "image"],

        ["galleryLightboxVideo", "video"]

    ]) {

        $(id).addEventListener("error", () => {

            if (

                dialog.open &&

                !$(id).hidden &&

                fileType(visible[previewIndex] || {}) === kind

            ) {

                show(id, false);

                show("galleryLightboxFallback", true);

            }

        });

    }


    /* ==========================================
       22 | LIGHTBOX CONTROLS
       ========================================== */

    $("galleryLightboxClose").addEventListener(

        "click",

        () => closePreview()

    );


    $("galleryLightboxPrevious").addEventListener(

        "click",

        () => step(-1)

    );


    $("galleryLightboxNext").addEventListener(

        "click",

        () => step(1)

    );


    /* CLOSE WITH ESCAPE KEY */

    dialog.addEventListener("cancel", event => {

        event.preventDefault();

        closePreview();

    });


    /* CLOSE BY CLICKING OUTSIDE IMAGE FRAME */

    dialog.addEventListener("click", event => {

        if (event.target === dialog) {

            closePreview();

        }

    });


    /* KEYBOARD IMAGE NAVIGATION */

    dialog.addEventListener("keydown", event => {

        // Preserve native video keyboard controls.

        if (event.target.closest("video")) return;


        if (

            event.key === "ArrowLeft" ||

            event.key === "ArrowRight"

        ) {

            event.preventDefault();


            step(

                event.key === "ArrowLeft"

                    ? -1

                    : 1

            );

        }

    });


    /* DOWNLOAD CURRENTLY PREVIEWED FILE */

    $("galleryLightboxDownload").addEventListener(

        "click",

        () => download(

            selected,

            visible[previewIndex]?.id,

            $("galleryLightboxDownload"),

            "galleryLightboxStatus"

        )

    );


    /* ==========================================
       23 | COLLECTION SEARCH AND SORTING
       ========================================== */

    $("collectionSearch").addEventListener(

        "input",

        renderCollections

    );


    $("collectionSort").addEventListener(

        "change",

        renderCollections

    );


    /* RETURN TO COLLECTIONS */

    $("backToCollections").addEventListener(

        "click",

        () => {

            if (active && !busy) {

                backToCollections();

            }

        }

    );


    /* ==========================================
       24 | GALLERY CATEGORY FILTERS

       All files
       Photography
       Videography
       Documents
       Other creative files
       ========================================== */

    document.querySelectorAll(".gallery-filter")

        .forEach(button => {

            button.addEventListener("click", () => {

                if (!active || !selected) return;


                filter = button.dataset.filter;

                renderFiles();

            });

        });


    /* ==========================================
       25 | DOWNLOAD ENTIRE COLLECTION
       ========================================== */

    $("downloadCollection").addEventListener(

        "click",

        () => download(

            selected,

            "all",

            $("downloadCollection"),

            "galleryDownloadStatus"

        )

    );


    /* ==========================================
       26 | REFRESH CLIENT COLLECTIONS
       ========================================== */

    $("refreshGalleries").addEventListener(

        "click",

        () => {

            if (!active) return;


            void run(

                $("refreshGalleries"),

                "REFRESHING...",

                "galleryMessage",

                async () => {

                    await loadCollections();

                    backToCollections();

                }

            );

        }

    );


    /* ==========================================
       27 | SECURE CLIENT LOGOUT
       ========================================== */

    $("galleryLogout").addEventListener(

        "click",

        async () => {

            if (!active || busy) return;


            busy = true;


            /* IMMEDIATELY CLEAR PRIVATE INFORMATION */

            lock("Signing out...");


            try {

                await api(

                    "/api/client/account/logout",

                    "POST",

                    {}

                );


                location.replace("client.html");


            } catch {

                lock(

                    "Gallery closed, but server logout could not be confirmed. " +

                    "Sign in again to retry logout.",

                    true

                );


            } finally {

                busy = false;

            }

        }

    );


    /* ==========================================
       28 | BACK-BUTTON PRIVACY PROTECTION
       ========================================== */

    window.addEventListener(

        "pagehide",

        () => lock("Checking account access...")

    );


    window.addEventListener(

        "pageshow",

        event => {

            if (event.persisted) {

                location.reload();

            }

        }

    );


    /* ==========================================
       29 | INITIALIZE PRIVATE CLIENT GALLERY
       ========================================== */

    async function initialize() {

        lock("Checking account access...");


        const started = generation;


        try {

            base = new URL(

                API_BASE || location.origin

            );


            /* ALLOW LOCAL DEVELOPMENT */

            const local =

                base.protocol === "http:" &&

                [

                    "localhost",

                    "127.0.0.1",

                    "[::1]"

                ].includes(base.hostname);


            /* VERIFY BACKEND CONFIGURATION */

            if (

                (base.protocol !== "https:" && !local) ||

                base.username ||

                base.password

            ) {

                throw new Error(

                    "Use an HTTPS backend or local development server."

                );

            }


            /* GITHUB PAGES BACKEND CHECK */

            if (

                !API_BASE &&

                base.hostname.endsWith(".github.io")

            ) {

                throw new Error(

                    "Account access is not connected yet."

                );

            }


            /* LOAD AUTHORIZED COLLECTIONS */

            await loadCollections();


            /* CHECK FOR A SPECIFIC GALLERY LINK */

            const id = new URLSearchParams(

                location.search

            ).get("project");


            if (id) {

                if (

                    collections.some(row =>

                        String(row.id) === id

                    )

                ) {

                    await run(

                        null,

                        "",

                        "galleryMessage",

                        () => openGallery(id)

                    );

                } else {

                    message(

                        "galleryMessage",

                        "That collection is not available to this account.",

                        true

                    );

                }

            }


        } catch (error) {

            if (generation === started) {

                lock(error.message, true);

            }

        }

    }


    /* ==========================================
       30 | START PRIVATE CLIENT GALLERY
       ========================================== */

    void initialize();

});


/* ==========================================
   END OF MONSE MEDIA PRIVATE CLIENT GALLERY
   ========================================== */