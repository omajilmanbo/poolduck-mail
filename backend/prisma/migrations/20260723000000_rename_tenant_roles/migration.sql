UPDATE "users" SET "role" = 'tenant_manager' WHERE "role" = 'root_admin';
UPDATE "users" SET "role" = 'operator' WHERE "role" = 'manager';
