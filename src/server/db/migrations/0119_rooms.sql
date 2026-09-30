CREATE TABLE `room_members` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`position` integer NOT NULL,
	`session_id` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `quick_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_members_room_agent` ON `room_members` (`room_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `room_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text,
	`content` text NOT NULL,
	`message_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_room_messages_room_created` ON `room_messages` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `room_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`room_message_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_message_id`) REFERENCES `room_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_room_turns_room_status_created` ON `room_turns` (`room_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `quick_sessions` ADD `room_id` text REFERENCES rooms(id) ON DELETE cascade;