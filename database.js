/* ==========================================
   MONSE MEDIA | DATABASE.JS
   SQLite Database & Email Reminders
   ========================================== */

"use strict";

function migrateDatabase(db) {

    const migrate = db.transaction(() => {

        db.exec(`

            /* CLIENT ACCOUNTS */

            CREATE TABLE IF NOT EXISTS client_accounts (

                id TEXT PRIMARY KEY NOT NULL,

                email TEXT NOT NULL COLLATE NOCASE UNIQUE,

                password_hash TEXT NOT NULL,

                first_name TEXT NOT NULL DEFAULT '',

                last_name TEXT NOT NULL DEFAULT '',

                preferred_language TEXT NOT NULL DEFAULT 'en'
                    CHECK (preferred_language IN ('en', 'es')),

                email_verified_at TEXT,

                created_at TEXT NOT NULL,

                updated_at TEXT NOT NULL,

                disabled_at TEXT,

                deletion_requested_at TEXT

            );


            /* CLIENT LOGIN SESSIONS */

            CREATE TABLE IF NOT EXISTS client_sessions (

                token_hash TEXT PRIMARY KEY NOT NULL,

                account_id TEXT NOT NULL
                    REFERENCES client_accounts(id)
                    ON DELETE CASCADE,

                purpose TEXT NOT NULL
                    CHECK (purpose IN ('login', 'recovery')),

                created_at TEXT NOT NULL,

                expires_at TEXT NOT NULL,

                revoked_at TEXT

            );


            /* ACCOUNT VERIFICATION TOKENS */

            CREATE TABLE IF NOT EXISTS account_tokens (

                token_hash TEXT PRIMARY KEY NOT NULL,

                account_id TEXT NOT NULL
                    REFERENCES client_accounts(id)
                    ON DELETE CASCADE,

                purpose TEXT NOT NULL CHECK (purpose IN (

                    'verify_email',

                    'reset_password',

                    'change_email'

                )),

                new_email TEXT,

                created_at TEXT NOT NULL,

                expires_at TEXT NOT NULL,

                used_at TEXT,

                revoked_at TEXT

            );


            /* ==========================================
               LEGACY SMS TABLES

               Retained for backward compatibility.
               No SMS service is activated.
               ========================================== */

            CREATE TABLE IF NOT EXISTS sms_preferences (

                account_id TEXT PRIMARY KEY NOT NULL
                    REFERENCES client_accounts(id)
                    ON DELETE CASCADE,

                phone TEXT,

                phone_verified_at TEXT,

                opted_in INTEGER NOT NULL DEFAULT 0
                    CHECK (opted_in IN (0, 1)),

                consent_at TEXT,

                consent_version TEXT,

                opted_out_at TEXT,

                updated_at TEXT NOT NULL,

                CHECK (opted_in = 0 OR (

                    phone IS NOT NULL
                    AND consent_at IS NOT NULL
                    AND consent_version IS NOT NULL

                ))

            );


            CREATE TABLE IF NOT EXISTS sms_consent_events (

                id TEXT PRIMARY KEY NOT NULL,

                account_id TEXT NOT NULL
                    REFERENCES client_accounts(id),

                phone TEXT NOT NULL,

                action TEXT NOT NULL
                    CHECK (action IN ('opt_in', 'opt_out')),

                source TEXT NOT NULL,

                consent_version TEXT,

                created_at TEXT NOT NULL

            );


            /* ==========================================
               CONFIRMED CLIENT APPOINTMENTS
               ========================================== */

            CREATE TABLE IF NOT EXISTS appointments (

                id TEXT PRIMARY KEY NOT NULL,

                project_id TEXT NOT NULL UNIQUE
                    REFERENCES projects(id),

                date TEXT NOT NULL,

                time TEXT NOT NULL,

                timezone TEXT NOT NULL
                    DEFAULT 'America/Chicago',

                location TEXT NOT NULL,

                starts_at TEXT NOT NULL,

                status TEXT NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN (

                        'confirmed',

                        'cancelled',

                        'completed'

                    )),

                revision INTEGER NOT NULL DEFAULT 1
                    CHECK (revision >= 1),

                created_at TEXT NOT NULL,

                updated_at TEXT NOT NULL

            );


            /* LEGACY SMS REMINDER RECORDS */

            CREATE TABLE IF NOT EXISTS sms_reminders (

                id TEXT PRIMARY KEY NOT NULL,

                appointment_id TEXT NOT NULL
                    REFERENCES appointments(id),

                appointment_revision INTEGER NOT NULL,

                kind TEXT NOT NULL
                    CHECK (kind IN ('week', 'day', 'morning')),

                due_at TEXT NOT NULL,

                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (

                        'pending',

                        'processing',

                        'sent',

                        'failed',

                        'skipped',

                        'cancelled',

                        'unknown'

                    )),

                claimed_at TEXT,

                sent_at TEXT,

                provider_message_id TEXT,

                created_at TEXT NOT NULL,

                updated_at TEXT NOT NULL,

                UNIQUE (

                    appointment_id,

                    appointment_revision,

                    kind

                )

            );


            /* ==========================================
               EMAIL NOTIFICATION PREFERENCES
               ========================================== */

            CREATE TABLE IF NOT EXISTS email_preferences (

                account_id TEXT PRIMARY KEY NOT NULL
                    REFERENCES client_accounts(id)
                    ON DELETE CASCADE,

                week_before INTEGER NOT NULL DEFAULT 0
                    CHECK (week_before IN (0, 1)),

                day_before INTEGER NOT NULL DEFAULT 0
                    CHECK (day_before IN (0, 1)),

                morning_of INTEGER NOT NULL DEFAULT 0
                    CHECK (morning_of IN (0, 1)),

                updated_at TEXT NOT NULL

            );


            /* ==========================================
               AUTOMATIC EMAIL REMINDER SCHEDULE
               ========================================== */

            CREATE TABLE IF NOT EXISTS email_reminders (

                id TEXT PRIMARY KEY NOT NULL,

                appointment_id TEXT NOT NULL
                    REFERENCES appointments(id)
                    ON DELETE CASCADE,

                appointment_revision INTEGER NOT NULL
                    CHECK (appointment_revision >= 1),

                kind TEXT NOT NULL
                    CHECK (kind IN (

                        'week',

                        'day',

                        'morning'

                    )),

                due_at TEXT NOT NULL,

                expires_at TEXT NOT NULL,

                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (

                        'pending',

                        'processing',

                        'sent',

                        'failed',

                        'skipped',

                        'cancelled',

                        'unknown'

                    )),

                claimed_at TEXT,

                sent_at TEXT,

                created_at TEXT NOT NULL,

                updated_at TEXT NOT NULL,


                /* PREVENT EXPIRED REMINDER SCHEDULES */

                CHECK (due_at < expires_at),


                /* PREVENT DUPLICATE REMINDERS */

                UNIQUE (

                    appointment_id,

                    appointment_revision,

                    kind

                )

            );


            /* ==========================================
               INITIALIZE NEW CLIENT PREFERENCES
               ========================================== */

            CREATE TRIGGER IF NOT EXISTS
                client_email_preferences_insert

            AFTER INSERT ON client_accounts

            BEGIN

                INSERT INTO email_preferences (

                    account_id,

                    updated_at

                )

                VALUES (

                    NEW.id,

                    NEW.created_at

                )

                ON CONFLICT(account_id) DO NOTHING;

            END;

        `);


        /* ==========================================
           INITIALIZE EXISTING CLIENT PREFERENCES

           Preserve previously saved preferences.
           SMS consent does not become email consent.
           ========================================== */

        db.prepare(`

            INSERT INTO email_preferences (

                account_id,

                updated_at

            )

            SELECT id, ?

            FROM client_accounts

            WHERE 1 = 1

            ON CONFLICT(account_id) DO NOTHING

        `).run(new Date().toISOString());


        /* ==========================================
           EXTEND EXISTING PROJECT DATABASE
           ========================================== */

        const columns = new Set(

            db.prepare(

                "PRAGMA table_info(projects)"

            ).all().map(column => column.name)

        );


        /* ADD MISSING PROJECT FIELDS */

        const additions = {

            account_id:

                "TEXT REFERENCES client_accounts(id)",

            event_time:

                "TEXT",

            timezone:

                "TEXT NOT NULL DEFAULT 'America/Chicago'",


            /* LEGACY SMS FIELDS */

            sms_opted_in:

                "INTEGER CHECK (sms_opted_in IN (0, 1))",

            sms_phone:

                "TEXT",

            sms_consent_at:

                "TEXT",

            sms_consent_version:

                "TEXT"

        };


        /* PRESERVE ALL EXISTING PROJECTS */

        for (

            const [name, definition]

            of Object.entries(additions)

        ) {

            if (!columns.has(name)) {

                db.exec(

                    `ALTER TABLE projects
                     ADD COLUMN ${name} ${definition}`

                );

            }

        }


        /* ==========================================
           DATABASE PERFORMANCE INDEXES
           ========================================== */

        db.exec(`

            CREATE INDEX IF NOT EXISTS projects_account_idx

                ON projects(

                    account_id,

                    created_at

                );


            CREATE INDEX IF NOT EXISTS files_project_idx

                ON files(

                    project_id,

                    kind

                );


            CREATE INDEX IF NOT EXISTS client_sessions_account_idx

                ON client_sessions(

                    account_id,

                    purpose,

                    expires_at

                );


            CREATE INDEX IF NOT EXISTS account_tokens_account_idx

                ON account_tokens(

                    account_id,

                    purpose,

                    expires_at

                );


            CREATE INDEX IF NOT EXISTS appointments_start_idx

                ON appointments(

                    status,

                    starts_at

                );


            CREATE INDEX IF NOT EXISTS email_reminders_due_idx

                ON email_reminders(

                    status,

                    due_at

                );


            CREATE INDEX IF NOT EXISTS sms_reminders_due_idx

                ON sms_reminders(

                    status,

                    due_at

                );


            CREATE INDEX IF NOT EXISTS sms_consent_account_idx

                ON sms_consent_events(

                    account_id,

                    created_at

                );

        `);

    });


    /* ==========================================
       EXECUTE SAFE DATABASE MIGRATION
       ========================================== */

    migrate.immediate();

}


/* ==========================================
   EXPORT DATABASE FUNCTIONS
   ========================================== */

module.exports = {

    migrateDatabase

};


/* ==========================================
   END OF MONSE MEDIA DATABASE.JS
   ========================================== */