interface Language {
  size: number;
  node: {
    name: string;
    color: string;
  };
}

interface Repository {
  nameWithOwner: string;
  stargazers: { totalCount: number };
  forkCount: number;
  languages: { edges: Language[] };
}

interface Overview {
  login: string;
  repositories: { nodes: Repository[] };
}

interface Week {
  w: number;
  a: number;
  d: number;
  c: number;
}

interface Contributor {
  total: number;
  weeks: Week[];
  author: { login: string };
}
