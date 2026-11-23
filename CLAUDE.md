# Working rules for Claude in this repository

- **Claude merges its own pull requests.** The owner has said this repeatedly (most recently
  2026-11-23): once the work is done and pushed, open the pull request and merge it yourself.
  Do not ask the owner to merge, and do not ask whether to open or merge the pull request.
  Report what was merged and what it deploys.
- **Finish the whole job without stopping to ask.** The owner repeated this on 2026-11-23 after
  being asked again whether to open, watch and merge a pull request, and whether to publish:
  do not pause for confirmation between steps and do not end a turn with "shall I…?". If merged
  work only reaches customers through a release or a site upload, cut the release yourself
  (CHANGELOG entry + a commit titled `Release vX.Y.Z — …`), wait for the run, check the live
  result, then report once at the end.
- Still stop and ask before anything destructive or irreversible beyond a merge (deleting
  data or branches, force-pushing, changing secrets), and say so plainly if a merge is blocked.
- The owner reads Arabic: write chat replies in Arabic. Code, commits and pull requests stay
  in English, as in the rest of the repository.
