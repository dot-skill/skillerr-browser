// Threads of work for the Orb's evaluations: searches (q:) and page titles, worded differently on purpose.
const THREADS = {
  japan: ['q:cheap flights to tokyo in october', 'Tokyo Narita flights from London - compare airfares', 'q:best area to stay in kyoto',
    'Where to Stay in Kyoto: Best Neighborhoods for First-Timers', 'q:japan rail pass worth it', 'JR Pass: Is the Japan Rail Pass Still Worth It?',
    'Kyoto temples you can visit in one day', 'q:tokyo hotels near shinjuku station'],
  desk: ['q:standing desk under 500', 'Best Standing Desks of 2026, Tested', 'Uplift V2 Standing Desk Review', 'q:ergonomic office chair lower back pain',
    'The 8 Best Office Chairs for Back Pain', 'q:monitor arm for home office', 'How to set up an ergonomic home office'],
  visa: ['q:schengen visa appointment', 'Apply for a Schengen visa: documents you need', 'q:travel insurance for schengen visa',
    'Visa application form - Embassy of France', 'q:passport photo size requirements', 'Book an appointment at the visa application centre'],
  baking: ['q:sourdough starter not rising', 'Why Your Sourdough Starter Isn\'t Rising (and How to Fix It)', 'q:best flour for bread',
    'Bread flour vs all-purpose flour: what\'s the difference?', 'q:dutch oven bread recipe', 'No-knead crusty bread baked in a cast iron pot'],
  react: ['q:react useeffect runs twice', 'Why does useEffect run twice in development? - Stack Overflow', 'q:react server components tutorial',
    'Understanding React Server Components', 'q:next.js app router data fetching', 'Data Fetching: Fetching Data on the Server | Next.js'],
  running: ['q:couch to 5k plan', 'Couch to 5K: a 9-week running plan for beginners', 'q:best running shoes for flat feet',
    'The Best Running Shoes for Overpronation', 'q:how to avoid shin splints', 'Shin splints: causes, treatment and prevention'],
  mortgage: ['q:mortgage rates today', 'Compare fixed-rate mortgages and current interest rates', 'q:how much house can i afford',
    'Home affordability calculator', 'q:first time home buyer programs', 'What first-time buyers need to know about down payments'],
  laptop: ['q:macbook air vs dell xps 13', 'MacBook Air M4 review: the best laptop for most people', 'q:best laptop for programming 2026',
    'Dell XPS 13 review: a great Windows ultrabook', 'q:laptop battery life comparison', 'Thin and light laptops with the longest battery life'],
};

// Held out: never used to set Kilr's thresholds, only to score them.
const HELD_OUT = {
  wedding: ['q:wedding venues near lake como', 'Lake Como Wedding Venues: Villas and Prices', 'q:wedding photographer italy cost',
    'How much does a destination wedding photographer cost?', 'q:save the date card ideas', 'Save-the-date etiquette: when to send them'],
  car: ['q:used electric car buying guide', 'Buying a Used EV: What to Check Before You Buy', 'q:tesla model 3 vs hyundai ioniq 5',
    'Ioniq 5 vs Model 3: Which Electric Car Should You Buy?', 'q:home ev charger installation cost', 'Level 2 home charging explained'],
  dog: ['q:best dog food for puppies', 'How Much Should I Feed My Puppy?', 'q:puppy crate training schedule',
    'Crate Training a Puppy: A Step-by-Step Guide', 'q:vaccination schedule for puppies', 'When should puppies get their shots?'],
  python: ['q:pandas groupby multiple columns', 'pandas.DataFrame.groupby - pandas documentation', 'q:python virtual environment tutorial',
    'Creating virtual environments with venv', 'q:pandas merge vs join', 'Merge, join and concatenate DataFrames in pandas'],
  garden: ['q:when to plant tomatoes', 'Growing Tomatoes: Planting, Care and Harvest', 'q:raised garden bed soil mix',
    'How to Fill a Raised Bed Garden', 'q:companion plants for tomatoes', 'Vegetable companion planting chart'],
  tax: ['q:how to file taxes as a freelancer', 'Self-employed tax guide: deductions and quarterly payments', 'q:home office tax deduction',
    'Can I deduct my home office? Rules for the self-employed', 'q:quarterly estimated tax due dates', 'Estimated taxes: how and when to pay'],
};

module.exports = { THREADS, HELD_OUT };
