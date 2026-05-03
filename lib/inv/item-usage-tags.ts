/**
 * Where (which machine / area) an item is consumed. Tags get attached to
 * InvItem.usageTags as a string[]. Add or rename here as the floor changes;
 * no DB migration needed.
 *
 * Grouped purely for nicer rendering in the picker — order within a group is
 * left to right, top to bottom.
 */
export const ITEM_USAGE_TAG_GROUPS = [
  {
    label: 'Boilers & utilities',
    tags: ['oil_boiler', 'steam_boiler', 'generator'],
  },
  {
    label: 'Process machines',
    tags: ['jet', 'farmatex', 'calender'],
  },
  {
    label: 'Folding line',
    tags: ['folding_machine1', 'folding_machine2'],
  },
  {
    label: 'Areas / halls',
    tags: ['grey_hall', 'folding_hall', 'dyeing', 'finishing', 'folding', 'office'],
  },
] as const

// Friendly labels for display (snake_case → Title Case Proper Noun).
export const ITEM_USAGE_TAG_LABELS: Record<string, string> = {
  oil_boiler: 'Oil Boiler',
  steam_boiler: 'Steam Boiler',
  generator: 'Generator',
  jet: 'Jet',
  farmatex: 'Farmatex',
  calender: 'Calender',
  folding_machine1: 'Folding M/c 1',
  folding_machine2: 'Folding M/c 2',
  grey_hall: 'Grey Hall',
  folding_hall: 'Folding Hall',
  dyeing: 'Dyeing',
  finishing: 'Finishing',
  folding: 'Folding',
  office: 'Office',
}

export const ITEM_USAGE_TAGS: readonly string[] = ITEM_USAGE_TAG_GROUPS.flatMap(g => g.tags)

export function labelForUsageTag(tag: string): string {
  return ITEM_USAGE_TAG_LABELS[tag] ?? tag
}
