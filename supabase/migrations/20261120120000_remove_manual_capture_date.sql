-- Retire the manual date editor's RPC. Existing dates and provenance remain
-- valid. Upload finalisation and legacy import still record capture metadata.
drop function public.set_media_captured_at(uuid, timestamptz);
