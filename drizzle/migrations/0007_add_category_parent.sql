ALTER TABLE "core"."categories" ADD COLUMN "parent_id" text;
ALTER TABLE "core"."categories"
  ADD CONSTRAINT "categories_parent_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "core"."categories"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
