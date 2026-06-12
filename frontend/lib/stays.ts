export type Stay = {
  slug: string;
  name: string;
  location: string;
  description: string;
  longDescription: string;
  image: string;
  pricePerNight: number;
  rating: number;
  guests: number;
  bedrooms: number;
  amenities: string[];
};

export const stays: Stay[] = [
  {
    slug: "cedar-house",
    name: "The Cedar House",
    location: "Mazandaran, Iran",
    description: "A warm timber retreat tucked between forest and sea.",
    longDescription: "Wake to filtered forest light and the scent of cedar. This calm, design-led home is made for long breakfasts, coastal walks, and evenings gathered around the fire.",
    image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1400&q=85",
    pricePerNight: 128,
    rating: 4.9,
    guests: 4,
    bedrooms: 2,
    amenities: ["Forest view", "Fireplace", "Full kitchen", "Free parking"],
  },
  {
    slug: "desert-courtyard",
    name: "Desert Courtyard",
    location: "Yazd, Iran",
    description: "An earthen hideaway centered around a cool blue courtyard.",
    longDescription: "A restored courtyard home that pairs traditional local craft with quiet modern comforts. Spend shaded afternoons beside the water and step out to explore the old city at dusk.",
    image: "https://images.unsplash.com/photo-1544986581-efac024faf62?auto=format&fit=crop&w=1400&q=85",
    pricePerNight: 96,
    rating: 4.8,
    guests: 3,
    bedrooms: 1,
    amenities: ["Courtyard", "Breakfast", "Air conditioning", "Old town location"],
  },
  {
    slug: "cliffside-villa",
    name: "Cliffside Villa",
    location: "Hormuz, Iran",
    description: "Sun-washed rooms and uninterrupted views of the gulf.",
    longDescription: "Built into the island landscape, this bright villa opens onto a wide terrace above the water. It is a peaceful base for beach days, island drives, and sunset dinners.",
    image: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1400&q=85",
    pricePerNight: 174,
    rating: 4.9,
    guests: 6,
    bedrooms: 3,
    amenities: ["Sea view", "Private terrace", "Outdoor dining", "Workspace"],
  },
  {
    slug: "garden-studio",
    name: "Garden Studio",
    location: "Shiraz, Iran",
    description: "A peaceful studio hidden in a fragrant city garden.",
    longDescription: "A compact and comfortable studio surrounded by citrus trees. Thoughtful details and a private garden corner make it an easy place to rest between days exploring Shiraz.",
    image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=85",
    pricePerNight: 82,
    rating: 4.7,
    guests: 2,
    bedrooms: 1,
    amenities: ["Private garden", "Kitchenette", "Fast Wi-Fi", "Central location"],
  },
  {
    slug: "mountain-lodge",
    name: "Alborz Mountain Lodge",
    location: "Dizin, Iran",
    description: "A relaxed alpine base with wide mountain views.",
    longDescription: "A comfortable mountain lodge for active days and unhurried nights. Large windows frame the ridgeline while natural textures keep the interior warm in every season.",
    image: "https://images.unsplash.com/photo-1542718610-a1d656d1884c?auto=format&fit=crop&w=1400&q=85",
    pricePerNight: 145,
    rating: 4.8,
    guests: 5,
    bedrooms: 2,
    amenities: ["Mountain view", "Wood stove", "Ski storage", "Parking"],
  },
  {
    slug: "old-town-loft",
    name: "Old Town Loft",
    location: "Isfahan, Iran",
    description: "A bright loft where historic details meet modern calm.",
    longDescription: "Set above a quiet lane, the loft balances exposed brick, generous light, and simple furnishings. Major landmarks, cafes, and artisan workshops are all within an easy walk.",
    image: "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1400&q=85",
    pricePerNight: 110,
    rating: 4.8,
    guests: 3,
    bedrooms: 1,
    amenities: ["City view", "Full kitchen", "Washer", "Walkable location"],
  },
];

export function getStay(slug: string) {
  return stays.find((stay) => stay.slug === slug);
}

