/**
 * The complaints table keeps its place columns in snake_case (gp_name,
 * village_code, assembly_constituency…) while everything else is camelCase, and
 * the database adapter passes columns through as stored. The screens read
 * `gpName`, `villageCode`, `assemblyConstituency` — so the panchayat and seat
 * never reached them. Responses carry both spellings; nothing is written back.
 */
export function withPlaceAliases<T extends Record<string, unknown>>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const r = row as Record<string, unknown>;
  return {
    ...row,
    gpName: r.gpName ?? r.gp_name ?? null,
    gpCode: r.gpCode ?? r.gp_code ?? null,
    villageCode: r.villageCode ?? r.village_code ?? null,
    assemblyConstituency: r.assemblyConstituency ?? r.assembly_constituency ?? null,
    parliamentaryConstituency: r.parliamentaryConstituency ?? r.parliamentary_constituency ?? null,
  };
}
