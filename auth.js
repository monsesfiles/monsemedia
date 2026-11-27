/* ==========================================
   MONSE MEDIA | AUTH.JS
   Client Authentication & Account Access
   Requires: supabase.js
   ========================================== */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    const $ = id => document.getElementById(id);
    const API = window.MonseAPI;

    const controller = new AbortController();

    const options = {
        signal: controller.signal
    };

    let leaving = false;
    let busy = false;
    let ready = false;


    /* ==========================================
       01 | DISPLAY HELPERS
       ========================================== */

    function message(id, value = "", error = false) {

        const el = $(id);

        if (!el) return;

        el.textContent = value;

        el.classList.toggle("is-error", error);
        el.classList.toggle("error", error);

    }


    function show(id, visible) {

        const el = $(id);

        if (!el) return;

        el.hidden = !visible;

        el.classList.toggle("hidden", !visible);

    }


    /* ==========================================
       02 | VERIFY BACKEND CONNECTION
       ========================================== */

    async function checkReady() {

        if (!API?.isConfigured()) {

            throw new Error(
                "Open the website through its Node.js server."
            );

        }

        const health = await API.checkHealth(options);

        if (!health.clientAccounts) {

            throw new Error(
                "Client accounts are not enabled yet."
            );

        }

        if (!leaving) ready = true;

    }


    /* ==========================================
       03 | SECURE ACCOUNT REQUESTS
       ========================================== */

    function account(path, method = "GET", data) {

        if (!ready || leaving) {

            throw new Error(
                "Account access is unavailable."
            );

        }

        return API.account(
            path,
            method,
            data,
            options
        );

    }


    /* VERIFY SERVER RESPONSE */

    function confirm(result) {

        if (result?.ok !== true) {

            throw new Error(
                "Request could not be confirmed."
            );

        }

        return result;

    }


    /* VERIFY CLIENT SESSION */

    async function session() {

        const result = await account("/session");

        if (
            result?.authenticated !== true ||
            !result.profile?.id
        ) {

            throw new Error(
                "Please sign in to your verified client account."
            );

        }

        return result.profile;

    }


    /* ==========================================
       04 | PREVENT DUPLICATE SUBMISSIONS
       ========================================== */

    async function run(
        fields,
        status,
        task,
        canUnlock = () => ready
    ) {

        if (
            busy ||
            leaving ||
            fields.disabled ||
            !ready
        ) return;

        busy = true;
        fields.disabled = true;

        message(status, "Please wait…");

        try {

            await task();

        } catch (error) {

            if (!leaving) {

                message(
                    status,
                    error.message,
                    true
                );

            }

        } finally {

            busy = false;

            fields.disabled =
                leaving || !canUnlock();

        }

    }


    /* ==========================================
       05 | PRIVATE TOKEN VALIDATION
       ========================================== */

    function validToken(token) {

        return /^[A-Za-z0-9_-]{43,128}$/
            .test(token || "");

    }


    function clearFragment() {

        history.replaceState(
            null,
            "",
            location.pathname + location.search
        );

    }


    /* ==========================================
       06 | CLIENT LOGIN & REGISTRATION
       ========================================== */

    async function setupLogin() {

        const form = $("clientLoginForm");

        const fields = $("clientLoginFields");

        const email = $("client-email");

        const password = $("client-password");

        const submit = form.querySelector(
            'button[type="submit"]'
        );

        const create = $("createAccount");

        let registering = false;

        fields.disabled = true;


        /* CREATE ADDITIONAL REGISTRATION INPUTS */

        function extra(
            id,
            labelText,
            type,
            autocomplete,
            max
        ) {

            const group =
                document.createElement("div");

            const label =
                document.createElement("label");

            const input =
                document.createElement("input");

            label.htmlFor = id;

            label.textContent = labelText;

            input.id = id;

            input.type = type;

            input.autocomplete = autocomplete;

            input.maxLength = max;

            group.append(label, input);

            return { group, input };

        }


        /* FIRST NAME */

        const first = extra(
            "registerFirstName",
            "FIRST NAME",
            "text",
            "given-name",
            80
        );


        /* LAST NAME */

        const last = extra(
            "registerLastName",
            "LAST NAME",
            "text",
            "family-name",
            80
        );


        /* CONFIRM PASSWORD */

        const repeat = extra(
            "registerConfirmPassword",
            "CONFIRM PASSWORD",
            "password",
            "new-password",
            128
        );

        fields.prepend(
            first.group,
            last.group
        );

        password.after(repeat.group);

        repeat.input.minLength = 12;


        /* ==========================================
           07 | SWITCH BETWEEN LOGIN & REGISTRATION
           ========================================== */

        function setMode(register) {

            registering = register;

            password.value = "";
            repeat.input.value = "";

            repeat.input.setCustomValidity("");


            /* DISPLAY REGISTRATION FIELDS */

            for (const item of [
                first,
                last,
                repeat
            ]) {

                item.group.hidden = !register;

                item.input.disabled = !register;

                item.input.required = register;

                if (!register) {

                    item.input.value = "";

                }

            }


            /* ACCOUNT INPUT REQUIREMENTS */

            email.maxLength = 254;

            password.maxLength = 128;

            password.minLength =
                register ? 12 : 0;

            password.autocomplete =

                register

                    ? "new-password"

                    : "current-password";


            /* UPDATE BUTTON LABELS */

            submit.textContent =

                register

                    ? "CREATE MY ACCOUNT ↗"

                    : "SIGN IN ↗";

            create.textContent =

                register

                    ? "BACK TO SIGN IN"

                    : "CREATE ACCOUNT";


            /* UPDATE ACCOUNT HEADING */

            message(
                "account-heading",

                register

                    ? "CREATE YOUR CLIENT ACCOUNT"

                    : "YOUR CLIENT ACCOUNT"
            );


            /* UPDATE ACCOUNT DESCRIPTION */

            message(
                "accountNotice",

                register

                    ? "Choose a password of at least 12 characters and verify your email before signing in."

                    : "Sign in to view your sessions and private collections."
            );

        }


        /* CREATE ACCOUNT BUTTON */

        create.addEventListener("click", () => {

            if (busy || fields.disabled) return;

            setMode(!registering);

            message("accountStatus");

            (
                registering
                    ? first.input
                    : email
            ).focus();

        });


        /* FORGOT PASSWORD BUTTON */

        $("forgotPassword").addEventListener(
            "click",
            () => {

                if (!busy && ready) {

                    location.assign(
                        "reset-password.html"
                    );

                }

            }
        );


        /* PASSWORD INPUT VALIDATION */

        for (const input of [
            password,
            repeat.input
        ]) {

            input.addEventListener(
                "input",
                () => {

                    repeat.input.setCustomValidity("");

                }
            );

        }


        /* ==========================================
           08 | SUBMIT LOGIN OR REGISTRATION
           ========================================== */

        form.addEventListener(
            "submit",
            event => {

                event.preventDefault();

                if (
                    busy ||
                    fields.disabled ||
                    !form.reportValidity()
                ) return;


                /* VERIFY REGISTRATION PASSWORD */

                if (
                    registering &&
                    (
                        password.value.length < 12 ||
                        password.value !== repeat.input.value
                    )
                ) {

                    repeat.input.setCustomValidity(
                        "Enter matching passwords of at least 12 characters."
                    );

                    repeat.input.reportValidity();

                    return;

                }


                /* COLLECT CLIENT INFORMATION */

                const data = {

                    email: email.value.trim(),

                    password: password.value

                };

                const register = registering;


                /* ADD REGISTRATION DETAILS */

                if (register) {

                    data.first_name =
                        first.input.value.trim();

                    data.last_name =
                        last.input.value.trim();

                }


                /* CLEAR PRIVATE PASSWORD INPUTS */

                password.value = "";
                repeat.input.value = "";


                /* CONNECT TO ACCOUNT SERVER */

                void run(
                    fields,
                    "accountStatus",
                    async () => {


                        /* ==================================
                           REGISTER NEW CLIENT
                           ================================== */

                        if (register) {

                            confirm(
                                await account(
                                    "/register",
                                    "POST",
                                    data
                                )
                            );

                            if (leaving) return;

                            setMode(false);

                            message(
                                "accountStatus",
                                "Check your email for verification instructions, if available."
                            );


                        /* ==================================
                           LOGIN EXISTING CLIENT
                           ================================== */

                        } else {

                            confirm(
                                await account(
                                    "/login",
                                    "POST",
                                    data
                                )
                            );

                            await session();

                            if (leaving) return;


                            /* REGULAR CLIENT DASHBOARD */

                            if (
                                !new URLSearchParams(
                                    location.hash.slice(1)
                                ).has("token")
                            ) {

                                if (
                                    new URLSearchParams(
                                        location.search
                                    ).has("project")
                                ) {

                                    location.reload();

                                } else {

                                    location.assign(
                                        "dashboard.html"
                                    );

                                }


                            /* ORIGINAL PRIVATE BOOKING */

                            } else {

                                message(
                                    "accountStatus",
                                    "Signed in. "
                                );

                                const link =
                                    document.createElement("a");

                                link.href = "dashboard.html";

                                link.textContent =
                                    "OPEN MY DASHBOARD ↗";

                                $("accountStatus").append(link);


                                /* LINK PREVIOUS BOOKING */

                                const claim =
                                    document.createElement("button");

                                claim.type = "button";

                                claim.textContent =
                                    "LINK THIS BOOKING TO MY ACCOUNT";

                                claim.addEventListener(
                                    "click",
                                    async () => {

                                        claim.disabled = true;

                                        try {

                                            const token =
                                                new URLSearchParams(
                                                    location.hash.slice(1)
                                                ).get("token");

                                            confirm(
                                                await account(
                                                    "/claim-project",
                                                    "POST",
                                                    { token }
                                                )
                                            );

                                            location.replace(
                                                "dashboard.html"
                                            );

                                        } catch (error) {

                                            if (!leaving) {

                                                message(
                                                    "accountStatus",
                                                    error.message,
                                                    true
                                                );

                                                $("accountStatus")
                                                    .append(link, claim);

                                                claim.disabled = false;

                                            }

                                        }

                                    }
                                );

                                $("accountStatus").append(claim);

                            }

                        }

                    }
                );

            }
        );


        /* CLEAR PRIVATE LOGIN INFORMATION */

        window.addEventListener(
            "pagehide",
            () => {

                form.reset();

                fields.disabled = true;

            }
        );


        /* ==========================================
           09 | EMAIL VERIFICATION
           ========================================== */

        setMode(false);

        message(
            "accountStatus",
            "Checking account availability…"
        );

        try {

            await checkReady();

            if (leaving) return;

            const params = new URLSearchParams(
                location.hash.slice(1)
            );

            const verification =

                params.has("verify") ||

                params.has("verify-email-change");


            /* VERIFY NEW ACCOUNT OR NEW EMAIL */

            if (
                verification &&
                !params.has("token")
            ) {

                const change =
                    params.has("verify-email-change");

                const token = params.get(

                    change

                        ? "verify-email-change"

                        : "verify"

                );

                clearFragment();


                /* VALIDATE PRIVATE VERIFICATION LINK */

                if (!validToken(token)) {

                    throw new Error(
                        "Invalid verification link."
                    );

                }

                message(
                    "accountStatus",
                    "Verifying your email…"
                );


                /* CONFIRM EMAIL WITH SERVER */

                confirm(
                    await account(

                        change

                            ? "/verify-email-change"

                            : "/verify-email",

                        "POST",

                        { token }

                    )
                );

                if (leaving) return;

                message(
                    "accountStatus",
                    "Email verified. You can now sign in."
                );

            } else {

                message("accountStatus");

            }

        } catch (error) {

            if (!leaving) {

                message(
                    "accountStatus",
                    error.message,
                    true
                );

            }

        } finally {

            fields.disabled =
                !ready || leaving;

        }

    }


    /* ==========================================
       10 | RETURNING CLIENT BOOKING ACCESS
       ========================================== */

    async function setupBooking() {

        const fields = $("bookingFields");

        const form = $("booking-form");

        let verified = false;


        /* LOCK PRIVATE BOOKING FORM */

        function lock(reason, error = false) {

            verified = false;

            fields.disabled = true;

            form.reset();

            message("bookingClientName");

            message("bookingClientEmail");

            message("booking-status");

            show("bookingWorkspace", false);

            show("bookingAccess", true);

            message(
                "bookingAccessStatus",
                reason,
                error
            );

        }


        /* PREVENT UNAUTHORIZED BOOKING SUBMISSIONS */

        form.addEventListener(
            "submit",
            event => {

                if (
                    !verified ||
                    fields.disabled ||
                    leaving
                ) {

                    event.preventDefault();

                    event.stopImmediatePropagation();

                }

            },
            true
        );


        /* CLEAR PRIVATE BOOKING INFORMATION */

        window.addEventListener(
            "pagehide",
            () => {

                lock(
                    "Checking account access…"
                );

            }
        );


        /* VERIFY RETURNING CLIENT */

        lock("Checking account access…");

        try {

            await checkReady();

            const p = await session();

            if (leaving) return;


            /* DISPLAY VERIFIED CLIENT NAME */

            message(
                "bookingClientName",

                [
                    p.first_name,
                    p.last_name
                ].filter(Boolean).join(" ") ||

                p.name ||

                "Client"

            );


            /* DISPLAY VERIFIED CLIENT EMAIL */

            message(
                "bookingClientEmail",
                p.email || ""
            );


            /* UNLOCK RETURNING CLIENT BOOKING */

            verified = true;

            fields.disabled = false;

            show("bookingAccess", false);

            show("bookingWorkspace", true);

        } catch (error) {

            if (!leaving) {

                lock(
                    error.message,
                    true
                );

            }

        }

    }


    /* ==========================================
       11 | PASSWORD RECOVERY
       ========================================== */

    async function setupRecovery() {

        const views = [

            "requestResetView",

            "resetEmailSentView",

            "verifyRecoveryView",

            "newPasswordView",

            "resetSuccessView",

            "invalidRecoveryView"

        ];

        const requestFields =
            $("resetRequestFields");

        const resetFields =
            $("resetPasswordFields");

        const password =
            $("resetNewPassword");

        const repeat =
            $("resetConfirmPassword");

        let recoveryAuthorized = false;

        let activeView = "requestResetView";


        /* SWITCH PASSWORD RECOVERY SCREENS */

        function view(id) {

            activeView = id;

            views.forEach(
                name => show(name, name === id)
            );

        }


        /* CLEAR PRIVATE PASSWORDS */

        function clearPasswords() {

            password.value = "";
            repeat.value = "";

            password.type = "password";
            repeat.type = "password";

            $("resetShowPasswords").checked = false;

            repeat.setCustomValidity("");

        }


        /* INITIALIZE PASSWORD RECOVERY */

        function start() {

            recoveryAuthorized = false;

            resetFields.disabled = true;

            clearPasswords();

            $("resetRequestForm").reset();

            message("resetRequestStatus");

            message("resetPasswordStatus");

            requestFields.disabled =
                !ready || leaving;

            view("requestResetView");

        }


        /* HANDLE INVALID OR EXPIRED RECOVERY LINKS */

        function invalid(reason) {

            recoveryAuthorized = false;

            resetFields.disabled = true;

            clearPasswords();

            message(
                "invalidRecoveryStatus",
                reason
            );

            view("invalidRecoveryView");

        }


        /* ==========================================
           12 | REQUEST PASSWORD RESET EMAIL
           ========================================== */

        $("resetRequestForm").addEventListener(
            "submit",
            event => {

                event.preventDefault();

                if (
                    requestFields.disabled ||
                    busy ||
                    !event.currentTarget.reportValidity()
                ) return;

                const email =
                    $("resetEmail").value.trim();

                void run(
                    requestFields,
                    "resetRequestStatus",

                    async () => {

                        confirm(
                            await account(
                                "/password/recovery/request",
                                "POST",
                                { email }
                            )
                        );

                        if (leaving) return;

                        $("resetRequestForm").reset();

                        view("resetEmailSentView");

                    },

                    () =>

                        ready &&

                        activeView === "requestResetView"

                );

            }
        );


        /* REQUEST ANOTHER RECOVERY EMAIL */

        for (const id of [
            "requestAnotherReset",
            "restartRecovery"
        ]) {

            $(id).addEventListener(
                "click",
                () => {

                    if (!busy) start();

                }
            );

        }


        /* ==========================================
           13 | PASSWORD VISIBILITY
           ========================================== */

        $("resetShowPasswords").addEventListener(
            "change",
            event => {

                password.type =

                    event.target.checked

                        ? "text"

                        : "password";

                repeat.type = password.type;

            }
        );


        /* CLEAR PASSWORD VALIDATION ERRORS */

        for (const input of [
            password,
            repeat
        ]) {

            input.addEventListener(
                "input",
                () => {

                    repeat.setCustomValidity("");

                }
            );

        }


        /* ==========================================
           14 | SAVE NEW CLIENT PASSWORD
           ========================================== */

        $("resetPasswordForm").addEventListener(
            "submit",
            event => {

                event.preventDefault();

                if (
                    !recoveryAuthorized ||
                    busy ||
                    resetFields.disabled ||
                    !event.currentTarget.reportValidity()
                ) return;


                /* VALIDATE NEW PASSWORD */

                if (
                    password.value.length < 12 ||
                    password.value !== repeat.value
                ) {

                    repeat.setCustomValidity(
                        "Enter matching passwords of at least 12 characters."
                    );

                    repeat.reportValidity();

                    return;

                }

                const new_password = password.value;

                clearPasswords();


                /* SUBMIT NEW PASSWORD */

                void run(
                    resetFields,
                    "resetPasswordStatus",

                    async () => {

                        try {

                            confirm(
                                await account(
                                    "/password/recovery/complete",
                                    "POST",
                                    { new_password }
                                )
                            );

                            if (leaving) return;

                            recoveryAuthorized = false;

                            view("resetSuccessView");

                        } catch (error) {

                            if (
                                [401, 403, 410]
                                    .includes(error.status)
                            ) {

                                invalid(
                                    "Your recovery link has expired. Request a new one."
                                );

                            } else {

                                throw error;

                            }

                        }

                    },

                    () =>

                        ready &&

                        recoveryAuthorized &&

                        activeView === "newPasswordView"

                );

            }
        );


        /* CLEAR PRIVATE PASSWORD RECOVERY DATA */

        window.addEventListener(
            "pagehide",
            () => {

                recoveryAuthorized = false;

                clearPasswords();

                $("resetRequestForm").reset();

                requestFields.disabled = true;

                resetFields.disabled = true;

            }
        );


        /* ==========================================
           15 | VERIFY PASSWORD RECOVERY LINK
           ========================================== */

        start();

        message(
            "recoveryConnectionStatus",
            "Checking account availability…"
        );

        try {

            await checkReady();

            if (leaving) return;

            message("recoveryConnectionStatus");

            const params = new URLSearchParams(
                location.hash.slice(1)
            );


            /* NO ACTIVE RECOVERY LINK */

            if (!params.has("recovery")) {

                requestFields.disabled = false;

                return;

            }


            /* EXTRACT PRIVATE RECOVERY TOKEN */

            const token = params.get("recovery");

            clearFragment();


            /* VALIDATE RECOVERY TOKEN */

            if (!validToken(token)) {

                invalid(
                    "Invalid recovery link. Request a new one."
                );

                return;

            }

            view("verifyRecoveryView");


            /* VERIFY RECOVERY WITH SERVER */

            const result = await account(
                "/password/recovery/verify",
                "POST",
                { token }
            );

            if (leaving) return;

            if (result?.recoveryAuthorized !== true) {

                invalid(
                    "Recovery authorization could not be verified."
                );

                return;

            }


            /* UNLOCK NEW PASSWORD FORM */

            recoveryAuthorized = true;

            resetFields.disabled = false;

            view("newPasswordView");

        } catch (error) {

            if (leaving) return;

            if (activeView === "verifyRecoveryView") {

                invalid(
                    error.message +
                    " Request a new link if needed."
                );

            } else {

                message(
                    "recoveryConnectionStatus",
                    error.message,
                    true
                );

            }

        }

    }


    /* ==========================================
       16 | PRIVATE PAGE SECURITY
       ========================================== */

    window.addEventListener(
        "pagehide",
        () => {

            leaving = true;

            controller.abort();

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
       17 | INITIALIZE AUTHENTICATION
       ========================================== */

    if ($("clientLoginForm")) {

        void setupLogin();

    } else if ($("bookingWorkspace")) {

        void setupBooking();

    } else if ($("resetRequestForm")) {

        void setupRecovery();

    }

});


/* ==========================================
   END OF MONSE MEDIA AUTH.JS
   ========================================== */