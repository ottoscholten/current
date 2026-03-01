
-- Sources table
CREATE TABLE public.sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Venue', 'Website')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Events table (for future use)
CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID REFERENCES public.sources(id),
  title TEXT NOT NULL,
  venue TEXT NOT NULL,
  neighbourhood TEXT,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Music', 'Dance', 'Comedy', 'Art', 'Other')),
  is_saved BOOLEAN NOT NULL DEFAULT false
);

-- Public read/write for sources (no auth required for this personal app)
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sources" ON public.sources FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to events" ON public.events FOR ALL USING (true) WITH CHECK (true);

-- Seed sources
INSERT INTO public.sources (name, url, type, last_synced_at) VALUES
  ('Fabric', 'https://fabriclondon.com', 'Venue', now() - interval '2 hours'),
  ('Barbican', 'https://barbican.org.uk', 'Venue', now() - interval '5 hours'),
  ('Village Underground', 'https://villageunderground.co.uk', 'Venue', now() - interval '1 hour'),
  ('Resident Advisor London', 'https://ra.co/events/uk/london', 'Website', now() - interval '3 hours'),
  ('Dice London', 'https://dice.fm/london', 'Website', now() - interval '4 hours'),
  ('London Dance Network', 'https://londondance.com', 'Website', now() - interval '24 hours');
