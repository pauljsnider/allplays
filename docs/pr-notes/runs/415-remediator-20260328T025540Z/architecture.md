Decision: keep the prune algorithm file-based and only change the source of truth for active PR numbers.

Current state:
- List existing Firebase `pr-*` channels.
- Build an in-memory newline-delimited `open_channels` list from a capped CLI query.
- Delete channels absent from `open_channels`, excluding the current PR channel.

Proposed state:
- Use `gh api --paginate repos/{owner}/{repo}/pulls?state=open&per_page=100`.
- Extract `.number` values from every page and normalize to `pr-<number>`.
- Reuse the existing grep-based membership check and delete loop.

Why this path:
- Lowest blast radius.
- Avoids changing Firebase parsing, deletion behavior, or deploy/report steps.
- Handles repositories with more than 200 open PRs deterministically.
