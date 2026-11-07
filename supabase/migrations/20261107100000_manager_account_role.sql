-- Venue manager accounts (part 1 of 3): the account role.
--
-- Its own file: Postgres cannot use a new enum value in the transaction that
-- adds it. Enum values cannot be dropped, so a withdrawal keeps 'manager' and
-- removes capabilities only (convert any manager rows back to staff first).
alter type public.app_role add value if not exists 'manager';
