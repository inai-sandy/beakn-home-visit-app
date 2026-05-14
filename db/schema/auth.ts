import { sql } from 'drizzle-orm';
import { boolean, pgEnum, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';

export const userRoleEnum = pgEnum('user_role', ['sales_executive', 'captain', 'super_admin']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    role: userRoleEnum('role').notNull(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 15 }).notNull(),
    email: varchar('email', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('users_phone_unique').on(table.phone),
    uniqueIndex('users_email_unique').on(table.email),
  ],
);
