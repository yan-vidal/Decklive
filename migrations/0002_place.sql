-- Local da foto como vem do yanlucas.com (design D1 de add-photo-info-and-motion).
-- As fotos já registradas ficam sem local até serem registradas de novo.
-- As coordenadas da origem não são gravadas: a playlist é pública.
ALTER TABLE media ADD COLUMN city TEXT;
ALTER TABLE media ADD COLUMN state TEXT;
ALTER TABLE media ADD COLUMN country TEXT;
