CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`username` text,
	`ip` text,
	`user_agent` text,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` integer,
	`summary` text NOT NULL,
	`before_json` text,
	`after_json` text
);
--> statement-breakpoint
CREATE INDEX `al_at` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `al_action_at` ON `audit_log` (`action`,`at`);--> statement-breakpoint
CREATE TABLE `auth_state` (
	`username` text PRIMARY KEY NOT NULL,
	`password_hash` text,
	`must_change_password` integer DEFAULT false NOT NULL,
	`token_version` integer DEFAULT 1 NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`cycle_period` integer,
	`cycle_unit` text DEFAULT 'MONTH' NOT NULL,
	`baseline_on` text,
	`stage_key` text,
	`covers_stages` text DEFAULT '' NOT NULL,
	`notify_enabled` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cat_device_name_uq` ON `categories` (`device_id`,`name`);--> statement-breakpoint
CREATE INDEX `cat_idx` ON `categories` (`device_id`,`active`,`sort`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`device_label` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_credential_id_unique` ON `credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `cred_username` ON `credentials` (`username`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`model` text,
	`installed_on` text,
	`ntfy_topic` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dev_idx` ON `devices` (`active`,`sort`);--> statement-breakpoint
CREATE TABLE `event_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ei_event_item_uq` ON `event_items` (`event_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `ei_category` ON `event_items` (`category_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `ei_item` ON `event_items` (`item_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`type` text NOT NULL,
	`occurred_on` text NOT NULL,
	`vendor` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ev_device_type_on` ON `events` (`device_id`,`type`,`occurred_on`);--> statement-breakpoint
CREATE INDEX `ev_device_on` ON `events` (`device_id`,`occurred_on`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`default_qty` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_category_name_uq` ON `items` (`category_id`,`name`);--> statement-breakpoint
CREATE INDEX `item_idx` ON `items` (`category_id`,`active`);--> statement-breakpoint
CREATE TABLE `machine_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notify_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`target` text NOT NULL,
	`due_on` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`claimed_at` integer NOT NULL,
	`sent_at` integer,
	`ntfy_id` text,
	FOREIGN KEY (`rule_id`) REFERENCES `notify_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nl_uq` ON `notify_log` (`rule_id`,`category_id`,`due_on`,`kind`);--> statement-breakpoint
CREATE INDEX `nl_retry` ON `notify_log` (`status`,`claimed_at`);--> statement-breakpoint
CREATE TABLE `notify_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`offset_days` integer,
	`repeat_days` integer,
	`template` text NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`measured_on` text NOT NULL,
	`raw_ppm` integer NOT NULL,
	`pure_ppm` integer NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`event_id` integer,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `readings_event_id_unique` ON `readings` (`event_id`);--> statement-breakpoint
CREATE INDEX `rd_device_on` ON `readings` (`device_id`,`measured_on`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
