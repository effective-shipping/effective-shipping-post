CREATE TABLE `connections` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_id` text NOT NULL,
	`account_name` text NOT NULL,
	`account_handle` text,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `provider`)
);
