// Placeholder data for fixtures and mock-ups: lorem ipsum plus plausible
// names, e-mails, addresses and the like. Not cryptographically random — the
// RNG is injectable so tests are deterministic.

export type Rng = () => number;

const FIRST = ["Ada", "Alan", "Grace", "Linus", "Margaret", "Dennis", "Barbara", "Ken", "Radia", "Tim", "Hedy", "Guido", "Frances", "Edsger", "Katherine", "Donald", "Shafi", "Yukihiro", "Anita", "Bjarne", "Amara", "Kofi", "Mei", "Ravi", "Sofia", "Mateo", "Leila", "Jonas"];
const LAST = ["Lovelace", "Turing", "Hopper", "Torvalds", "Hamilton", "Ritchie", "Liskov", "Thompson", "Perlman", "Berners-Lee", "Lamarr", "van Rossum", "Allen", "Dijkstra", "Johnson", "Knuth", "Goldwasser", "Matsumoto", "Borg", "Stroustrup", "Mensah", "Boateng", "Chen", "Patel", "García", "Rossi", "Haddad", "Berg"];
const STREETS = ["Maple", "Oak", "Pine", "Cedar", "Elm", "Willow", "Harbor", "Mill", "Station", "Church", "Park", "Lake", "Hill", "River"];
const STREET_KIND = ["Street", "Avenue", "Road", "Lane", "Way", "Drive", "Court"];
const CITIES = ["Springfield", "Riverton", "Lakeview", "Fairview", "Kingsport", "Westbrook", "Ashford", "Bayside", "Northwood", "Millbrook"];
const COMPANY_A = ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Vandelay", "Stark", "Wayne", "Soylent", "Tyrell", "Cyberdyne", "Aperture"];
const COMPANY_B = ["Labs", "Systems", "Industries", "Group", "Technologies", "Holdings", "Works", "Dynamics"];
const DOMAINS = ["example.com", "example.org", "example.net", "test.dev"];
const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum".split(" ");

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const digits = (rng: Rng, n: number) => Array.from({ length: n }, () => int(rng, 0, 9)).join("");

export function loremSentence(rng: Rng, words = int(rng, 6, 14)): string {
  const w = Array.from({ length: words }, () => pick(rng, LOREM));
  const s = w.join(" ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

export function loremParagraph(rng: Rng, sentences = int(rng, 3, 6)): string {
  return Array.from({ length: sentences }, () => loremSentence(rng)).join(" ");
}

export function fullName(rng: Rng): string {
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}

export function email(rng: Rng, name = fullName(rng)): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `${slug}@${pick(rng, DOMAINS)}`;
}

/** Luhn check digit, for test card numbers. */
export function luhnComplete(partial: string): string {
  let sum = 0;
  for (let i = 0; i < partial.length; i++) {
    let d = Number(partial[partial.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return partial + ((10 - (sum % 10)) % 10);
}

export const FAKE_KINDS = {
  name: { label: "Full name", gen: fullName },
  email: { label: "E-mail (example.com)", gen: (r: Rng) => email(r) },
  phone: { label: "Phone (+1 555 …)", gen: (r: Rng) => `+1 555-${digits(r, 3)}-${digits(r, 4)}` },
  address: { label: "Street address", gen: (r: Rng) => `${int(r, 1, 9999)} ${pick(r, STREETS)} ${pick(r, STREET_KIND)}, ${pick(r, CITIES)} ${digits(r, 5)}` },
  company: { label: "Company", gen: (r: Rng) => `${pick(r, COMPANY_A)} ${pick(r, COMPANY_B)}` },
  username: { label: "Username", gen: (r: Rng) => `${pick(r, FIRST).toLowerCase()}_${pick(r, LAST).toLowerCase().replace(/[^a-z]/g, "")}${int(r, 1, 99)}` },
  ipv4: { label: "IPv4 (documentation range)", gen: (r: Rng) => `${pick(r, ["192.0.2", "198.51.100", "203.0.113"])}.${int(r, 1, 254)}` },
  color: { label: "Hex colour", gen: (r: Rng) => `#${int(r, 0, 0xffffff).toString(16).padStart(6, "0")}` },
  date: { label: "Date (ISO, last 5 years)", gen: (r: Rng) => new Date(Date.UTC(2021, 0, 1) + int(r, 0, 5 * 365) * 86_400_000).toISOString().slice(0, 10) },
  card: { label: "Test card number (Luhn-valid)", gen: (r: Rng) => luhnComplete(`4000${digits(r, 11)}`) },
  sentence: { label: "Lorem ipsum sentence", gen: (r: Rng) => loremSentence(r) },
  paragraph: { label: "Lorem ipsum paragraph", gen: (r: Rng) => loremParagraph(r) },
} as const;

export type FakeKind = keyof typeof FAKE_KINDS;
