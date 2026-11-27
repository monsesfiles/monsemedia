/* ==========================================
   MONSE MEDIA | REMINDERS.JS
   Automatic Appointment Email Scheduler
   ========================================== */

"use strict";

const { randomUUID } = require("node:crypto");

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const iso = ms => new Date(ms).toISOString();

const kinds = {
    week: "week_before",
    day: "day_before",
    morning: "morning_of"
};


/* ==========================================
   01 | CALENDAR DATE VALIDATION
   ========================================== */

function calendarDate(date) {

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
        throw new Error("Invalid date.");
    }

    const ms = Date.parse(date + "T00:00:00Z");

    if (
        !Number.isFinite(ms) ||
        iso(ms).slice(0, 10) !== date
    ) {
        throw new Error("Invalid date.");
    }

    return ms;

}


function shiftDate(date, days) {

    return iso(
        calendarDate(date) + days * 24 * HOUR
    ).slice(0, 10);

}


/* ==========================================
   02 | APPOINTMENT TIME ZONES
   ========================================== */

function localToUTC(date, time, timezone) {

    calendarDate(date);

    if (
        !/^([01]\d|2[0-3]):[0-5]\d$/
            .test(time || "")
    ) {
        throw new Error("Invalid time.");
    }

    if (
        typeof timezone !== "string" ||
        !timezone.trim()
    ) {
        throw new Error("Invalid time zone.");
    }

    const fmt = new Intl.DateTimeFormat("en-GB", {

        timeZone: timezone,

        year: "numeric",

        month: "2-digit",

        day: "2-digit",

        hour: "2-digit",

        minute: "2-digit",

        second: "2-digit",

        hourCycle: "h23"

    });


    /* CONVERT LOCAL TIME */

    function wall(ms) {

        const p = Object.fromEntries(

            fmt.formatToParts(ms)

                .map(x => [x.type, x.value])

        );

        return Date.parse(

            `${p.year}-${p.month}-${p.day}` +

            `T${p.hour}:${p.minute}:${p.second}Z`

        );

    }

    const target = Date.parse(
        `${date}T${time}:00Z`
    );

    const offsets = new Set();


    /* ACCOUNT FOR DAYLIGHT SAVING TIME */

    for (let h = -36; h <= 36; h += 6) {

        const sample = target + h * HOUR;

        offsets.add(wall(sample) - sample);

    }

    const matches = [...offsets]

        .map(offset => target - offset)

        .filter(ms => wall(ms) === target);


    /* REJECT AMBIGUOUS OR NONEXISTENT TIMES */

    if (matches.length !== 1) {

        throw new Error(
            "Choose an unambiguous local date and time."
        );

    }

    return iso(matches[0]);

}


/* ==========================================
   03 | CALCULATE REMINDER SCHEDULE
   ========================================== */

function reminderTimes(
    a,
    morningHour = 8,
    leadMinutes = 120
) {

    const start = Date.parse(

        localToUTC(
            a.date,
            a.time,
            a.timezone
        )

    );

    if (Date.parse(a.starts_at) !== start) {

        throw new Error(
            "Appointment UTC time does not match local time."
        );

    }

    const schedule = [];


    /* DEFAULT EMAIL SCHEDULE */

    for (const [kind, days, hour] of [

        ["week", -7, 9],

        ["day", -1, 9],

        ["morning", 0, morningHour]

    ]) {

        const date = shiftDate(a.date, days);

        let due;

        try {

            due = Date.parse(

                localToUTC(

                    date,

                    `${String(hour).padStart(2, "0")}:00`,

                    a.timezone

                )

            );

        } catch {

            // Skip invalid local reminder times.

            continue;

        }


        /* PREVENT LATE APPOINTMENT REMINDERS */

        const end = Math.min(

            due + 3 * HOUR,

            start - (

                kind === "morning"

                    ? leadMinutes * MINUTE

                    : 0

            )

        );


        /* SKIP EARLY MORNING APPOINTMENTS */

        if (end <= due) continue;


        schedule.push({

            kind,

            due_at: iso(due),

            expires_at: iso(end)

        });

    }

    return schedule;

}


/* ==========================================
   04 | CREATE AUTOMATIC EMAIL SCHEDULER
   ========================================== */

function createReminders({ db, mailer }) {

    const enabled =
        process.env.REMINDERS_ENABLED === "true";

    const morningHour = Number(

        process.env.REMINDER_MORNING_HOUR ?? 8

    );

    const leadMinutes = Number(

        process.env.REMINDER_MIN_LEAD_MINUTES ?? 120

    );


    /* VALIDATE SCHEDULER CONFIGURATION */

    if (

        !Number.isInteger(morningHour) ||

        morningHour < 6 ||

        morningHour > 11 ||

        !Number.isInteger(leadMinutes) ||

        leadMinutes < 30 ||

        leadMinutes > 720

    ) {

        throw new Error(
            "Invalid email reminder configuration."
        );

    }

    let timer = null;

    let running = null;

    let stopping = false;


    /* VERIFY EMAIL SERVICE AVAILABILITY */

    const isConfigured = () =>

        enabled && mailer.isConfigured();


    /* ==========================================
       05 | SAVE SCHEDULED EMAILS
       ========================================== */

    const insert = db.prepare(`

        INSERT INTO email_reminders (

            id,

            appointment_id,

            appointment_revision,

            kind,

            due_at,

            expires_at,

            status,

            created_at,

            updated_at

        )

        VALUES (

            ?, ?, ?, ?, ?, ?, 'pending', ?, ?

        )

        ON CONFLICT (

            appointment_id,

            appointment_revision,

            kind

        ) DO NOTHING

    `);


    /* ==========================================
       06 | UPDATE APPOINTMENT REMINDERS
       ========================================== */

    const reconcile = db.transaction((now) => {


        /* CANCEL OUTDATED REMINDERS */

        db.prepare(`

            UPDATE email_reminders

            SET

                status = 'cancelled',

                updated_at = ?

            WHERE status = 'pending'

            AND NOT EXISTS (

                SELECT 1

                FROM appointments a

                WHERE a.id =
                    email_reminders.appointment_id

                AND a.revision =
                    email_reminders.appointment_revision

                AND a.status = 'confirmed'

            )

        `).run(now);


        /* SKIP EXPIRED REMINDERS */

        db.prepare(`

            UPDATE email_reminders

            SET

                status = 'skipped',

                updated_at = ?

            WHERE status = 'pending'

            AND expires_at <= ?

        `).run(now, now);


        /* HANDLE INTERRUPTED EMAIL ATTEMPTS */

        db.prepare(`

            UPDATE email_reminders

            SET

                status = 'unknown',

                updated_at = ?

            WHERE status = 'processing'

            AND claimed_at <= ?

        `).run(

            now,

            iso(Date.parse(now) - 10 * MINUTE)

        );


        /* FIND CONFIRMED UPCOMING APPOINTMENTS */

        const rows = db.prepare(`

            SELECT *

            FROM appointments

            WHERE status = 'confirmed'

            AND starts_at > ?

        `).all(now);


        /* GENERATE REMINDER RECORDS */

        for (const a of rows) {

            let times;

            try {

                times = reminderTimes(

                    a,

                    morningHour,

                    leadMinutes

                );

            } catch {

                console.error(

                    "Monse Media: invalid appointment schedule."

                );

                continue;

            }


            /* SAVE FUTURE REMINDERS */

            for (const r of times) {

                if (

                    r.due_at < a.updated_at ||

                    r.expires_at <= now

                ) continue;

                insert.run(

                    randomUUID(),

                    a.id,

                    a.revision,

                    r.kind,

                    r.due_at,

                    r.expires_at,

                    now,

                    now

                );

            }

        }

    });


    /* ==========================================
       07 | CLAIM EMAIL REMINDER
       ========================================== */

    const claim = db.transaction(now => {

        const row = db.prepare(`

            SELECT id

            FROM email_reminders

            WHERE status = 'pending'

            AND due_at <= ?

            AND expires_at > ?

            ORDER BY due_at, id

            LIMIT 1

        `).get(now, now);

        if (!row) return null;


        /* PREVENT DUPLICATE EMAIL PROCESSING */

        const result = db.prepare(`

            UPDATE email_reminders

            SET

                status = 'processing',

                claimed_at = ?,

                updated_at = ?

            WHERE id = ?

            AND status = 'pending'

        `).run(

            now,

            now,

            row.id

        );

        return result.changes === 1

            ? row.id

            : null;

    });


    /* ==========================================
       08 | VERIFY CLIENT EMAIL PREFERENCES
       ========================================== */

    const details = db.prepare(`

        SELECT

            r.kind,

            r.expires_at,

            a.date,

            a.time,

            a.timezone,

            a.location,

            c.email,

            c.first_name AS name,

            e.week_before,

            e.day_before,

            e.morning_of

        FROM email_reminders r

        JOIN appointments a

            ON a.id = r.appointment_id

            AND a.revision = r.appointment_revision

        JOIN projects p

            ON p.id = a.project_id

        JOIN client_accounts c

            ON c.id = p.account_id

        JOIN email_preferences e

            ON e.account_id = c.id

        WHERE r.id = ?

        AND r.status = 'processing'

        AND r.expires_at > ?

        AND a.status = 'confirmed'

        AND a.starts_at > ?

        AND c.email_verified_at IS NOT NULL

        AND c.disabled_at IS NULL

        AND c.deletion_requested_at IS NULL

    `);


    /* SAVE FINAL EMAIL STATUS */

    const finish = db.prepare(`

        UPDATE email_reminders

        SET

            status = ?,

            sent_at = ?,

            updated_at = ?

        WHERE id = ?

        AND status = 'processing'

    `);


    /* ==========================================
       09 | SEND INDIVIDUAL EMAIL REMINDER
       ========================================== */

    async function processOne(id) {

        const now = iso(Date.now());

        const row = details.get(

            id,

            now,

            now

        );

        let status = "skipped";


        /* VERIFY CURRENT CLIENT CONSENT */

        if (

            row &&

            Object.hasOwn(kinds, row.kind) &&

            row[kinds[row.kind]] === 1

        ) {

            try {

                const accepted =

                    await mailer.sendAppointmentReminder(

                        row.email,

                        row,

                        row.kind

                    );

                status = accepted === true

                    ? "sent"

                    : "unknown";

            } catch {

                status = "unknown";

            }

        }


        /* RECORD EMAIL RESULT */

        const ended = iso(Date.now());

        finish.run(

            status,

            status === "sent" ? ended : null,

            ended,

            id

        );

    }


    /* ==========================================
       10 | AUTOMATIC SCHEDULER CYCLE
       ========================================== */

    async function cycle() {

        if (

            !isConfigured() ||

            stopping

        ) return;


        /* UPDATE SCHEDULED EMAILS */

        reconcile.immediate(

            iso(Date.now())

        );


        /* SEND UP TO 20 EMAILS PER CYCLE */

        for (

            let i = 0;

            i < 20 && !stopping;

            i++

        ) {

            const id = claim.immediate(

                iso(Date.now())

            );

            if (!id) break;

            await processOne(id);

        }

    }


    /* ==========================================
       11 | PREVENT OVERLAPPING CYCLES
       ========================================== */

    function tick() {

        if (running) return running;

        if (

            stopping ||

            !isConfigured()

        ) {

            return Promise.resolve();

        }

        running = cycle()

            .catch(() => {

                console.error(

                    "Monse Media: email reminder cycle failed."

                );

            })

            .finally(() => {

                running = null;

            });

        return running;

    }


    /* ==========================================
       12 | START AUTOMATIC REMINDERS
       ========================================== */

    function start() {

        if (

            timer ||

            !isConfigured()

        ) return false;

        stopping = false;


        /* CHECK DATABASE EVERY MINUTE */

        timer = setInterval(() => {

            void tick();

        }, MINUTE);

        timer.unref();


        /* CHECK IMMEDIATELY ON SERVER START */

        void tick();

        return true;

    }


    /* ==========================================
       13 | SAFELY STOP SCHEDULER
       ========================================== */

    async function stop() {

        stopping = true;

        if (timer) {

            clearInterval(timer);

        }

        timer = null;

        await running;

    }


    /* ==========================================
       14 | EXPORT SCHEDULER FUNCTIONS
       ========================================== */

    return {

        isConfigured,

        start,

        stop,

        tick

    };

}


/* ==========================================
   EXPORT REMINDER MODULE
   ========================================== */

module.exports = {

    createReminders,

    localToUTC,

    reminderTimes

};


/* ==========================================
   END OF MONSE MEDIA REMINDERS.JS
   ========================================== */