ALTER TABLE "questionnaire_rows" ADD COLUMN "draftId" TEXT;
CREATE UNIQUE INDEX "questionnaire_rows_draftId_key" ON "questionnaire_rows"("draftId");
ALTER TABLE "questionnaire_rows" ADD CONSTRAINT "questionnaire_rows_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
