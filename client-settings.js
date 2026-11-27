/* ==========================================
   MONSE MEDIA | CLIENT-SETTINGS.JS
   Client Account & Email Preferences
   Requires: supabase.js
   ========================================== */

"use strict";

document.addEventListener("DOMContentLoaded", () => {

    const API = window.MonseAPI;
    const controller = new AbortController();
    const $ = id => document.getElementById(id);
    const dialog = $("deletionDialog");

    const forms = [
        "profileForm",
        "emailForm",
        "notificationsForm",
        "passwordForm",
        "deletionForm"
    ];

    const fields = [
        "profileFields",
        "emailFields",
        "notificationFields",
        "passwordFields",
        "deletionFields"
    ];

    const reminderKeys = [
        "week_before",
        "day_before",
        "morning_of"
    ];

    const reminderInput = key =>
        $("notificationFields").querySelector(
            `[name="${key}"]`
        );

    const passwordIds = [
        "currentPassword",
        "newPassword",
        "confirmPassword"
    ];

    let active = false;
    let busy = false;
    let leaving = false;
    let generation = 0;

    let accountId = null;
    let account = null;


    /* 01 | DISPLAY HELPERS */

    function text(id, value = "") {
        $(id).textContent = value ?? "";
    }

    function show(id, visible) {
        $(id).hidden = !visible;
        $(id).classList.toggle("hidden", !visible);
    }

    function message(id, value = "", type = "") {

        text(id, value);

        $(id).classList.remove(
            "success", "error", "is-error"
        );

        if (type) $(id).classList.add(type);

        if (type === "error") {
            $(id).classList.add("is-error");
        }

    }


    /* CLEAR PRIVATE PASSWORDS */

    function clearPasswords() {

        for (const id of [
            ...passwordIds,
            "emailPassword",
            "deletionPassword"
        ]) {

            $(id).value = "";
            $(id).type = "password";

        }

        $("showPasswords").checked = false;
        $("confirmPassword").setCustomValidity("");

    }


    /* CLOSE ACCOUNT DELETION DIALOG */

    function closeDeletion(restore = true) {

        if (dialog.open) dialog.close();

        $("deletionForm").reset();
        $("deletionPassword").value = "";
        $("deletionFields").disabled = true;

        message("deletionDialogStatus");

        if (restore && active) {
            $("requestAccountDeletion").focus();
        }

    }


    /* ==========================================
       02 | PRIVATE ACCOUNT SECURITY
       ========================================== */

    function lock(reason, error = false) {

        active = false;
        generation++;

        account = null;
        accountId = null;

        show("settingsWorkspace", false);
        show("settingsAccess", true);

        closeDeletion(false);

        forms.forEach(id => $(id).reset());

        fields.forEach(id => {
            $(id).disabled = true;
        });

        for (const id of [
            "disableReminders",
            "requestAccountDeletion",
            "settingsLogout"
        ]) {
            $(id).disabled = true;
        }

        for (const id of [
            "firstName",
            "lastName",
            "profileEmail",
            "newEmail"
        ]) {
            $(id).value = "";
        }

        reminderKeys.forEach(key => {
            reminderInput(key).checked = false;
        });

        clearPasswords();

        for (const id of [
            "settingsClientName",
            "settingsClientEmail",
            "memberSince",
            "currentEmail"
        ]) {
            text(id);
        }

        text("profileInitials", "MM");

        text(
            "emailVerificationStatus",
            "Verification status unavailable."
        );

        text(
            "settingsEmailReminderStatus",
            "Preferences unavailable."
        );

        text("settingsReminderEmail");

        for (const id of [
            "emailVerificationStatus",
            "settingsEmailReminderStatus"
        ]) {
            $(id).removeAttribute("data-status");
        }

        for (const id of [
            "settingsMessage",
            "profileStatus",
            "emailStatus",
            "notificationStatus",
            "passwordStatus",
            "deletionStatus"
        ]) {
            message(id);
        }

        message(
            "settingsAccessStatus",
            reason,
            error ? "is-error" : ""
        );

    }


    /* ==========================================
       03 | SECURE BACKEND CONNECTION
       ========================================== */

    async function api(
        path,
        method = "GET",
        data
    ) {

        if (!API || leaving) {
            throw new Error(
                "Account access is unavailable."
            );
        }

        const started = generation;

        try {

            const result = await API.account(
                path,
                method,
                data,
                {
                    signal: controller.signal
                }
            );

            if (leaving || started !== generation) {
                throw new Error(
                    "Account access changed."
                );
            }

            return result;

        } catch (error) {

            if (
                !leaving &&
                started === generation &&
                error.status === 401
            ) {

                lock(
                    "Please sign in again to manage your account.",
                    true
                );

            }

            throw error;

        }

    }


    /* CONFIRM ACCOUNT CHANGES */

    async function change(path, data) {

        const result = await api(
            path,
            "POST",
            data
        );

        if (result?.ok !== true) {
            throw new Error(
                "The change could not be confirmed."
            );
        }

        return result;

    }


    /* ==========================================
       04 | ACCOUNT CONTROL AVAILABILITY
       ========================================== */

    function syncControls() {

        const caps = account?.capabilities || {};

        const enabled = key =>
            active &&
            !busy &&
            !leaving &&
            caps[key] === true;

        $("profileFields").disabled =
            !enabled("profile");

        $("emailFields").disabled =
            !enabled("email");

        $("notificationFields").disabled =
            !enabled("notifications") ||
            !reminderKeys.every(key =>
                typeof account?.email_preferences?.[key]
                    === "boolean"
            );

        $("passwordFields").disabled =
            !enabled("password");

        $("deletionFields").disabled =
            !enabled("deletion") || !dialog.open;

        $("requestAccountDeletion").disabled =
            !enabled("deletion") ||
            account?.deletionPending === true;

        $("disableReminders").disabled =
            !enabled("notifications") ||
            !reminderKeys.some(key =>
                account?.email_preferences?.[key] === true
            );

        $("settingsLogout").disabled =
            !active || busy;

        $("closeDeletionDialog").disabled = busy;
        $("cancelDeletion").disabled = busy;

    }


    /* ==========================================
       05 | DISPLAY VERIFIED CLIENT PROFILE
       ========================================== */

    function render(data) {

        if (
            leaving ||
            data?.authenticated !== true ||
            !data.profile?.id ||
            String(data.profile.id) !== accountId
        ) {

            throw new Error(
                "Account information could not be verified."
            );

        }

        account = data;

        const p = data.profile;
        const prefs = data.email_preferences;


        /* CLIENT NAME */

        const name = [
            p.first_name,
            p.last_name
        ].filter(Boolean).join(" ") ||
            p.name ||
            "Client";

        const initials = name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(s => Array.from(s)[0])
            .join("")
            .toUpperCase();

        text("profileInitials", initials || "MM");
        text("settingsClientName", name);
        text("settingsClientEmail", p.email || "");


        /* ACCOUNT CREATION DATE */

        const joined = new Date(
            p.created_at || ""
        );

        text(
            "memberSince",
            Number.isNaN(joined.getTime())

                ? ""

                : `Member since ${
                    joined.toLocaleDateString(
                        "en-US",
                        {
                            month: "long",
                            year: "numeric"
                        }
                    )
                }`
        );


        /* PERSONAL INFORMATION */

        $("firstName").value =
            p.first_name || "";

        $("lastName").value =
            p.last_name || "";

        $("profileEmail").value =
            p.email || "";

        $("preferredLanguage").value =
            p.preferred_language === "es"
                ? "es"
                : "en";

        text("currentEmail", p.email || "");


        /* EMAIL VERIFICATION STATUS */

        text(
            "emailVerificationStatus",

            p.emailChangePending === true

                ? "Email change pending verification."

                : p.emailVerified === true

                ? "Email verified"

                : "Email verification not confirmed."
        );

        $("emailVerificationStatus").dataset.status =

            p.emailChangePending === true

                ? "pending"

                : p.emailVerified === true

                ? "verified"

                : "unverified";


        /* ==========================================
           EMAIL NOTIFICATION PREFERENCES
           ========================================== */

        const known = reminderKeys.every(
            key => typeof prefs?.[key] === "boolean"
        );

        for (const key of reminderKeys) {
            reminderInput(key).checked =
                known && prefs[key];
        }

        const count = known

            ? reminderKeys.filter(
                key => prefs[key]
            ).length

            : 0;

        text(
            "settingsEmailReminderStatus",

            !known

                ? "Preferences unavailable."

                : count

                ? `${count} of 3 reminders enabled`

                : "Email reminders are off."
        );

        $("settingsEmailReminderStatus").dataset.status =

            !known

                ? "unknown"

                : count

                ? "opted-in"

                : "opted-out";


        /* VERIFIED REMINDER EMAIL */

        text(
            "settingsReminderEmail",

            p.emailVerified === true

                ? `Reminders will be sent to: ${p.email}`

                : "A verified email address is required."
        );


        /* ACCOUNT DELETION STATUS */

        if (data.deletionPending === true) {

            message(
                "deletionStatus",
                "Your account deletion request is awaiting review."
            );

        }


        /* UNLOCK VERIFIED ACCOUNT */

        active = true;

        show("settingsAccess", false);
        show("settingsWorkspace", true);

        syncControls();

    }


    /* REFRESH ACCOUNT INFORMATION */

    async function refresh() {
        render(await api("/settings"));
    }


    /* ==========================================
       06 | PREVENT DUPLICATE SUBMISSIONS
       ========================================== */

    async function run(statusId, task) {

        if (!active || busy || leaving) return;

        busy = true;

        syncControls();
        message(statusId);

        const started = generation;

        try {

            await task();

        } catch (error) {

            if (
                active &&
                !leaving &&
                started === generation
            ) {

                message(
                    statusId,
                    error.message ||
                    "Request could not be confirmed.",
                    "error"
                );

            }

        } finally {

            busy = false;

            if (!leaving) syncControls();

        }

    }


    /* SAVE AND REFRESH ACCOUNT */

    async function save(
        path,
        data,
        statusId,
        success
    ) {

        await change(path, data);

        if (leaving) return;

        try {

            await refresh();

        } catch {

            if (!leaving) {

                lock(
                    "Your change was accepted, but updated account access could not be verified. Sign in again.",
                    true
                );

            }

            return;

        }

        if (!leaving && active) {

            message(
                statusId,
                success,
                "success"
            );

        }

    }


    /* HANDLE FORM SUBMISSIONS */

    function onSubmit(
        formId,
        fieldId,
        handler
    ) {

        $(formId).addEventListener(
            "submit",
            event => {

                event.preventDefault();

                if (
                    !active ||
                    busy ||
                    $(fieldId).disabled ||
                    !$(formId).reportValidity()
                ) return;

                handler();

            }
        );

    }


    /* ==========================================
       07 | UPDATE PERSONAL INFORMATION
       ========================================== */

    onSubmit(
        "profileForm",
        "profileFields",
        () => {

            const first_name =
                $("firstName").value.trim();

            const last_name =
                $("lastName").value.trim();

            if (
                !first_name ||
                !last_name ||
                first_name.length > 80 ||
                last_name.length > 80
            ) {

                return message(
                    "profileStatus",
                    "Enter your first and last name (up to 80 characters each).",
                    "error"
                );

            }

            void run(
                "profileStatus",
                () => save(
                    "/profile",
                    {
                        first_name,
                        last_name,
                        preferred_language:
                            $("preferredLanguage").value
                    },
                    "profileStatus",
                    "Your personal information has been updated."
                )
            );

        }
    );


    /* ==========================================
       08 | CHANGE CLIENT EMAIL ADDRESS
       ========================================== */

    onSubmit(
        "emailForm",
        "emailFields",
        () => {

            const new_email =
                $("newEmail").value.trim();

            const current_password =
                $("emailPassword").value;

            $("emailPassword").value = "";

            if (
                new_email.length > 254 ||
                !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
                    .test(new_email)
            ) {

                return message(
                    "emailStatus",
                    "Enter a valid email address.",
                    "error"
                );

            }

            if (
                new_email.toLowerCase() ===
                String(
                    account.profile.email || ""
                ).toLowerCase()
            ) {

                return message(
                    "emailStatus",
                    "Enter a different email address.",
                    "error"
                );

            }

            void run(
                "emailStatus",
                async () => {

                    await save(
                        "/email",
                        {
                            new_email,
                            current_password
                        },
                        "emailStatus",
                        "Email change requested. Follow the verification instructions sent by the account service."
                    );

                    $("newEmail").value = "";

                }
            );

        }
    );


    /* ==========================================
       09 | SAVE EMAIL REMINDER PREFERENCES
       ========================================== */

    onSubmit(
        "notificationsForm",
        "notificationFields",
        () => {

            const email_preferences =
                Object.fromEntries(

                    reminderKeys.map(key => [

                        key,
                        reminderInput(key).checked

                    ])

                );

            void run(
                "notificationStatus",
                () => save(
                    "/notifications",
                    { email_preferences },
                    "notificationStatus",
                    "Your email reminder preferences have been saved."
                )
            );

        }
    );


    /* ==========================================
       10 | DISABLE ALL EMAIL REMINDERS
       ========================================== */

    $("disableReminders").addEventListener(
        "click",
        () => {

            if ($("disableReminders").disabled) return;

            const email_preferences =
                Object.fromEntries(

                    reminderKeys.map(
                        key => [key, false]
                    )

                );

            void run(
                "notificationStatus",
                () => save(
                    "/notifications",
                    { email_preferences },
                    "notificationStatus",
                    "Optional email reminders are off. Your appointments are unchanged."
                )
            );

        }
    );


    /* ==========================================
       11 | PASSWORD VISIBILITY
       ========================================== */

    $("showPasswords").addEventListener(
        "change",
        () => {

            passwordIds.forEach(id => {

                $(id).type =
                    $("showPasswords").checked
                        ? "text"
                        : "password";

            });

        }
    );

    passwordIds.forEach(id => {

        $(id).addEventListener(
            "input",
            () => {

                $("confirmPassword")
                    .setCustomValidity("");

            }
        );

    });


    /* ==========================================
       12 | CHANGE CLIENT PASSWORD
       ========================================== */

    onSubmit(
        "passwordForm",
        "passwordFields",
        () => {

            const current_password =
                $("currentPassword").value;

            const new_password =
                $("newPassword").value;

            if (
                new_password.length < 12 ||
                new_password.length > 128 ||
                new_password === current_password
            ) {

                return message(
                    "passwordStatus",
                    "Choose a different password with 12–128 characters.",
                    "error"
                );

            }

            if (
                new_password !==
                $("confirmPassword").value
            ) {

                $("confirmPassword")
                    .setCustomValidity(
                        "Passwords do not match."
                    );

                $("confirmPassword").reportValidity();

                return;

            }

            clearPasswords();

            void run(
                "passwordStatus",
                async () => {

                    await change(
                        "/password",
                        {
                            current_password,
                            new_password
                        }
                    );

                    lock(
                        "Password updated. Please sign in with your new password."
                    );

                }
            );

        }
    );


    /* ==========================================
       13 | REQUEST ACCOUNT DELETION
       ========================================== */

    $("requestAccountDeletion").addEventListener(
        "click",
        () => {

            if (
                !active ||
                busy ||
                $("requestAccountDeletion").disabled
            ) return;

            $("deletionForm").reset();

            message("deletionDialogStatus");

            dialog.showModal();

            syncControls();

        }
    );

    for (const id of [
        "closeDeletionDialog",
        "cancelDeletion"
    ]) {

        $(id).addEventListener(
            "click",
            () => {
                if (!busy) closeDeletion();
            }
        );

    }

    dialog.addEventListener(
        "cancel",
        event => {

            event.preventDefault();

            if (!busy) closeDeletion();

        }
    );

    onSubmit(
        "deletionForm",
        "deletionFields",
        () => {

            if (
                !dialog.open ||
                !$("deletionAcknowledgment").checked
            ) return;

            const data = {
                reason:
                    $("deletionReason").value.trim(),

                current_password:
                    $("deletionPassword").value,

                acknowledge: true
            };

            $("deletionPassword").value = "";

            void run(
                "deletionDialogStatus",
                async () => {

                    await change(
                        "/deletion-request",
                        data
                    );

                    if (
                        leaving ||
                        !active ||
                        !account
                    ) return;

                    account.deletionPending = true;

                    closeDeletion(false);

                    message(
                        "deletionStatus",
                        "Your deletion request was received for review. No immediate deletion has been performed.",
                        "success"
                    );

                }
            );

        }
    );


    /* ==========================================
       14 | CLIENT ACCOUNT LOGOUT
       ========================================== */

    $("settingsLogout").addEventListener(
        "click",
        async () => {

            if (!active || busy || leaving) return;

            busy = true;

            lock("Signing out...");

            try {

                await change("/logout", {});

                if (!leaving) {
                    location.replace("client.html");
                }

            } catch {

                if (!leaving) {

                    lock(
                        "Account settings closed, but server logout could not be confirmed. Sign in again to retry logout.",
                        true
                    );

                }

            } finally {

                busy = false;

                syncControls();

            }

        }
    );


    /* ==========================================
       15 | PRIVATE ACCOUNT CLEANUP
       ========================================== */

    window.addEventListener("pagehide", () => {

        leaving = true;

        controller.abort();

        lock("Checking account access...");

    });

    window.addEventListener("pageshow", event => {

        if (event.persisted) location.reload();

    });


    /* ==========================================
       16 | INITIALIZE ACCOUNT SETTINGS
       ========================================== */

    async function initialize() {

        lock("Checking account access...");

        const started = generation;

        try {

            if (!API?.isConfigured()) {

                throw new Error(
                    "Open Monse Media through its Node.js server."
                );

            }

            const health = await API.checkHealth({
                signal: controller.signal
            });

            if (
                leaving ||
                generation !== started
            ) return;

            if (!health.clientAccounts) {

                throw new Error(
                    "Client accounts are not enabled yet."
                );

            }

            const session = await api("/session");

            if (
                session?.authenticated !== true ||
                !session.profile?.id
            ) {

                throw new Error(
                    "Please sign in to your client account."
                );

            }

            accountId = String(
                session.profile.id
            );

            await refresh();

            if (
                location.hash === "#notifications"
            ) {

                $("notifications").scrollIntoView({
                    block: "start"
                });

            }

        } catch (error) {

            if (
                !leaving &&
                generation === started
            ) {

                lock(

                    error.status === 404

                        ? "The account settings service is not connected yet."

                        : error.message,

                    true
                );

            }

        }

    }


    /* START CLIENT ACCOUNT SETTINGS */

    void initialize();

});


/* ==========================================
   END OF MONSE MEDIA CLIENT-SETTINGS.JS
   ========================================== */