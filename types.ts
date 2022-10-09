interface FetchedLanguage {
    size: number;
    node: {
        name: string;
        color: string;
    };
}

interface FetchedRepository {
    nameWithOwner: string;
    stargazers: { totalCount: number };
    forkCount: number;
    languages: { edges: FetchedLanguage[] };
}

interface FetchedOverview {
    login: string;
    repositories: { nodes: FetchedRepository[] };
}

interface OverviewGQL {
    data?: { viewer?: FetchedOverview }
}

interface Week {
    w: number;
    a: number;
    d: number;
    c: number;
}

interface FetchedContributor {
    total: number;
    weeks: Week[];
    author: { login: string };
}
