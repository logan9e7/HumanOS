CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hypothesis_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_user` ON `feedback` (`user_id`);--> statement-breakpoint
CREATE TABLE `hypotheses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parameter_id` text NOT NULL,
	`scope` text NOT NULL,
	`claim` text NOT NULL,
	`status` text NOT NULL,
	`evidence_strength` text NOT NULL,
	`support_ids` text NOT NULL,
	`counter_ids` text NOT NULL,
	`alternatives` text NOT NULL,
	`revision` integer NOT NULL,
	`valid_from` text NOT NULL,
	`superseded_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hypotheses_user_parameter` ON `hypotheses` (`user_id`,`parameter_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text NOT NULL,
	`trace` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_user_time` ON `messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_user_request_role` ON `messages` (`user_id`,`request_id`,`role`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text NOT NULL,
	`parameter_id` text NOT NULL,
	`quote` text NOT NULL,
	`value` text NOT NULL,
	`direction` text NOT NULL,
	`scope` text NOT NULL,
	`timeframe` text NOT NULL,
	`source` text NOT NULL,
	`strength` text NOT NULL,
	`intensity` integer,
	`episode_key` text NOT NULL,
	`retracted` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `observations_user_parameter` ON `observations` (`user_id`,`parameter_id`);--> statement-breakpoint
CREATE INDEX `observations_user_time` ON `observations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`consented_at` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`llm_consent` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quotas` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotas_user_day` ON `quotas` (`user_id`,`day`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revisions_user_time` ON `revisions` (`user_id`,`created_at`);