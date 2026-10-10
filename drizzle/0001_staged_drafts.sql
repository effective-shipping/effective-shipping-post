CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`draft` text NOT NULL,
	`created_at` integer NOT NULL
);
