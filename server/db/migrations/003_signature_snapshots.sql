-- Each step keeps a COPY of the signature image used at the moment of signing, so changing or deleting
-- your saved signature later never alters documents you already signed.
ALTER TABLE request_steps ADD COLUMN signature_image text;
