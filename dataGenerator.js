const SALE_REGIONS = ["North America", "EMEA", "LATAM", "APAC"];
const PRODUCT_LINES = ["Enterprise", "Retail", "Platform", "Cloud"];
const SUPPORT_CHANNELS = ["Email", "Chat", "Phone", "In-app"];

function pick(list, index) {
  return list[index % list.length];
}

function randomPercent(min, max) {
  return Number((min + Math.random() * (max - min)).toFixed(3));
}

const mockSchemas = {
  sales: [
    {
      key: "region",
      generator: (index) => pick(SALE_REGIONS, index)
    },
    {
      key: "productLine",
      generator: (index) => pick(PRODUCT_LINES, index + 1)
    },
    {
      key: "quarter",
      generator: (index) => `Q${(index % 4) + 1}`
    },
    {
      key: "bookings",
      generator: (index) => 90000 + Math.round(Math.sin(index + 1) * 25000)
    },
    {
      key: "growth",
      generator: () => randomPercent(0.02, 0.17)
    }
  ],
  support: [
    {
      key: "channel",
      generator: (index) => pick(SUPPORT_CHANNELS, index)
    },
    {
      key: "tickets",
      generator: (index) => 60 + Math.round(Math.cos(index) * 15)
    },
    {
      key: "csat",
      generator: () => Number((75 + Math.random() * 25).toFixed(1))
    },
    {
      key: "resolutionTime",
      generator: (index) => 4 + (index % 5)
    }
  ],
  marketing: [
    {
      key: "channel",
      generator: (index) => pick(["Paid Search", "Organic", "Email", "Events"], index)
    },
    {
      key: "leads",
      generator: (index) => 400 + index * 25
    },
    {
      key: "costPerLead",
      generator: () => Number((20 + Math.random() * 35).toFixed(2))
    },
    {
      key: "mqlRate",
      generator: () => randomPercent(0.05, 0.21)
    }
  ]
};

const realSamples = {
  sales: [
    {
      region: "North America",
      productLine: "Enterprise",
      quarter: "Q1",
      bookings: 142000,
      growth: 0.124
    },
    {
      region: "EMEA",
      productLine: "Cloud",
      quarter: "Q2",
      bookings: 98000,
      growth: 0.087
    },
    {
      region: "APAC",
      productLine: "Platform",
      quarter: "Q3",
      bookings: 115400,
      growth: 0.105
    },
    {
      region: "LATAM",
      productLine: "Retail",
      quarter: "Q4",
      bookings: 91000,
      growth: 0.092
    }
  ],
  support: [
    {
      channel: "Email",
      tickets: 72,
      csat: 88.4,
      resolutionTime: 3
    },
    {
      channel: "Chat",
      tickets: 61,
      csat: 92.1,
      resolutionTime: 2
    },
    {
      channel: "Phone",
      tickets: 48,
      csat: 86.6,
      resolutionTime: 5
    },
    {
      channel: "In-app",
      tickets: 55,
      csat: 90.2,
      resolutionTime: 3
    }
  ],
  marketing: [
    {
      channel: "Paid Search",
      leads: 520,
      costPerLead: 29.5,
      mqlRate: 0.18
    },
    {
      channel: "Organic",
      leads: 430,
      costPerLead: 12.1,
      mqlRate: 0.15
    },
    {
      channel: "Email",
      leads: 210,
      costPerLead: 8.4,
      mqlRate: 0.12
    },
    {
      channel: "Events",
      leads: 310,
      costPerLead: 45.7,
      mqlRate: 0.22
    }
  ]
};

function prepareSample(category, rows) {
  const bucket = realSamples[category] || realSamples.sales;
  const result = [];
  for (let idx = 0; idx < rows; idx += 1) {
    const entry = bucket[idx % bucket.length];
    result.push({ ...entry });
  }
  return result;
}

export function availableCategories() {
  return Object.keys(realSamples);
}

export function generateMockDataset({ rows = 5, category = "sales" }) {
  const schema = mockSchemas[category] || mockSchemas.sales;
  return Array.from({ length: rows }, (_, idx) => {
    const row = {};
    schema.forEach((field) => {
      row[field.key] = field.generator(idx);
    });
    return row;
  });
}

export function getRealDataset(category = "sales", rows = 5) {
  return prepareSample(category, rows);
}
