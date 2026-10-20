CREATE TABLE `app_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metrics_expiry` ON `app_metrics` (`expires_at`);--> statement-breakpoint
CREATE TABLE `usage_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`units` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_expiry` ON `usage_buckets` (`expires_at`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `memory_paused` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `consent_version` text DEFAULT 'legacy' NOT NULL;