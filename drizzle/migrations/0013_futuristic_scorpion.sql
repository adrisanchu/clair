CREATE TABLE "core"."cost_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD COLUMN "cost_group" text;--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD COLUMN "cost_group_by_id" text;--> statement-breakpoint
ALTER TABLE "core"."cost_groups" ADD CONSTRAINT "cost_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "core"."workspaces"("id") ON DELETE no action ON UPDATE no action;