// Assign the complete session list before filtering or pagination. Surviving
// sessions keep their artwork; new sessions use every available resident before
// repeating one. This map is presentation state, never a source of agent status.
export function assignResidents(view, rows, pool) {
  const choices = [...new Set(pool)], allowed = new Set(choices);
  const live = new Set(rows.map((row) => row.id));
  const assignments = view.residentAssignments ??= new Map();
  for (const [id, sprite] of assignments) if (!live.has(id) || !allowed.has(sprite)) assignments.delete(id);
  if (!choices.length) return assignments;
  const counts = new Map(choices.map((name) => [name, 0]));
  for (const name of assignments.values()) counts.set(name, counts.get(name) + 1);
  for (const row of rows) {
    if (assignments.has(row.id)) continue;
    const least = Math.min(...counts.values());
    const name = choices.find((name) => counts.get(name) === least);
    assignments.set(row.id, name);
    counts.set(name, least + 1);
  }
  return assignments;
}
