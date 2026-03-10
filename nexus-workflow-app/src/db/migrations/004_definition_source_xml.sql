-- Add source XML column to store the original BPMN XML for each definition
ALTER TABLE definitions ADD COLUMN IF NOT EXISTS source_xml TEXT;
