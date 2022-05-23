import * as eta from "https://deno.land/x/eta@v1.12.3/mod.ts";
import type { Contributor, Overview } from "./main.d.ts";
import "https://deno.land/x/dotenv@v3.2.0/load.ts";

const GITHUB_API = "https://api.github.com/";
const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const EXCLUDED = Deno.env.get("EXCLUDED")?.split(",") ?? [];

const DEBUG = Deno.env.get("DEBUG") == "true";

const headers = new Headers();
headers.set("Authorization", "Token " + Deno.env.get("TOKEN"));

// deno-lint-ignore no-explicit-any
async function queryRest(url: URL): Promise<any | null> {
	if (DEBUG) console.log("requesting api endpoint " + url.pathname);
	async function inner() {
		try {
			const r = await fetch(url, { headers });
			const j = await r.text();
			if (r.status == 202) {
				return null;
			}
			return JSON.parse(j);
		} catch {
			return null;
		}
	}

	for (let i = 0; i < 60; ++i) {
		const r = await inner();
		if (r !== null) {
			return r;
		} else {
			console.log("retrying..");
			await sleep(2000);
		}
	}

	console.log("timeout error");
	return null;
}

// deno-lint-ignore no-explicit-any
function query(q: string): Promise<any> {
	console.log("requesting graphql request");
	return fetch(GITHUB_GRAPHQL, {
		headers,
		method: "POST",
		body: JSON.stringify({ query: q })
	}).then(r => r.json());
}

function sleep(m: number) {
	return new Promise(r => setTimeout(r, m));
}

async function fetchOverview() {
	const r = await query(await Deno.readTextFile("overview.gql", {}));
	return r?.data?.viewer as Overview | undefined;
}

/* start */
const overview = await fetchOverview();
if (overview === undefined) throw new Error("could not fetch overview");

/* lines */
const WEEK = 60 * 60 * 24 * 7;
async function lines() {
	const now = Date.now() / 1000;
	const currentWeek = now - (now % WEEK) + 259200;

	const unprocessedWeeks: Record<string, number>[] = [];
	const unprocessedCumulative: Record<string, number> = {};
	for (const repo of overview!.repositories.nodes) {
		if (EXCLUDED.includes(repo.nameWithOwner)) {
			continue;
		}

		// calculate the ratio of languages in this repo
		const unnormalizedRatio: [string, number][] = [];
		let ratioSum = 0;
		for (const { size, node } of repo.languages.edges) {
			if (DEBUG) console.log(node.name, size);
			unnormalizedRatio.push([node.color, size]);
			ratioSum += size;
		}

		const normalizedRatio: [string, number][] = unnormalizedRatio.map(
			([color, size]) => [color, size / ratioSum]
		);

		// get actual contributor data
		const contributorData: Contributor[] | null = await queryRest(
			new URL(`/repos/${repo.nameWithOwner}/stats/contributors`, GITHUB_API)
		);

		if (contributorData === null) {
			throw new Error(`attempt to get repo failed`);
		}

		for (const contributor of contributorData) {
			if (contributor.author.login != overview!.login) {
				continue;
			}

			for (const week of contributor.weeks) {
				const weekOffset = (currentWeek - week.w) / WEEK;
				const lines = week.a;

				// scale languages linearly
				if (unprocessedWeeks[weekOffset] === undefined) {
					const m: Record<string, number> = {};
					for (const [color, ratio] of normalizedRatio) {
						const x = lines * ratio;
						m[color] = x;
						if (unprocessedCumulative[color]) {
							unprocessedCumulative[color] += x;
						} else {
							unprocessedCumulative[color] = x;
						}
					}
					unprocessedWeeks[weekOffset] = m;
				} else {
					const m = unprocessedWeeks[weekOffset];
					for (const [color, ratio] of normalizedRatio) {
						const x = lines * ratio;
						if (m[color]) {
							m[color] += x;
						} else {
							m[color] = x;
						}
						if (unprocessedCumulative[color]) {
							unprocessedCumulative[color] += x;
						} else {
							unprocessedCumulative[color] = x;
						}
					}
				}
			}

			break;
		}
	}

	// process data
	const data = [];
	const cumulative: Record<string, number> = {};
	const lastDiff: Record<string, number> = {};

	let diffNormal = 0;
	let cumulativeNormal = 0;
	for (let year = (unprocessedWeeks.length / 52) >> 0; year-- > 0; ) {
		const yearData = [];
		const yearIndex = (year + 1) * 52;
		for (let week = 0; week < 52; ++week) {
			const w = unprocessedWeeks[yearIndex - week];
			if (w === undefined) continue;

			let cumulativeDiff = 0;
			let cumulativeCumulative = 0;

			const weekData: [string, [number, number]][] = [];
			for (const color in w) {
				const x = w[color];

				// https://en.wikipedia.org/wiki/Moving_average#Exponential_moving_average
				const weight = 0.8;
				const last = lastDiff[color] ?? x;
				const smoothed = last * weight + (1 - weight) * x;
				lastDiff[color] = smoothed;

				cumulativeDiff += smoothed;
				if (cumulative[color]) {
					cumulativeCumulative += cumulative[color] += x;
				} else {
					cumulativeCumulative += cumulative[color] = x;
				}

				weekData.push([color, [cumulative[color], smoothed]]);
			}

			// adjust normals
			if (cumulativeCumulative > cumulativeNormal) {
				cumulativeNormal = cumulativeCumulative;
			}

			if (cumulativeDiff > diffNormal) {
				diffNormal = cumulativeDiff;
			}

			weekData.sort(
				(a, b) => unprocessedCumulative[b[0]] - unprocessedCumulative[a[0]]
			);
			yearData.push(weekData);
		}
		data.push(yearData);
	}

	return { data, diffNormal, cumulativeNormal };
}

const linesTemplate = await Deno.readTextFile("templates/lines.ejs");
const processedLines = await eta.renderAsync(linesTemplate, await lines());
await Deno.mkdir("generated", { recursive: true });
await Deno.writeTextFile("generated/lines.svg", processedLines!);
