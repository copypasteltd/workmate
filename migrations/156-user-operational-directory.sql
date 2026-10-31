-- Historical origin/activity remains unknown. A later login must not invent origin.
ALTER TABLE users ADD COLUMN registration_source text
 CHECK(registration_source IS NULL OR registration_source='email_otp');
ALTER TABLE users ADD COLUMN last_active_at timestamptz;
CREATE INDEX users_last_active_directory ON users(last_active_at DESC,id DESC)
 WHERE last_active_at IS NOT NULL;
CREATE INDEX tasks_admin_user_role_directory ON tasks(created_by,role_key,created_at,id);
