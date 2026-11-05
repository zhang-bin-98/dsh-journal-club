# Security and research data

Journal Club runs inside DeepSeek Harness. The host provides model access,
session permissions and file previews. The plugin stores ordinary project files;
it does not add a cloud database or account system.

- High-precision parsing uses the official MinerU API through the bundled Node
  runner and uploads the supplied paper to that service. Configure `MINERU_TOKEN`
  or reuse the token in an existing `~/.mineru/config.yaml`, never in project files,
  command arguments or chat examples. Tokens and signed URLs are not logged or
  persisted in the project manifest; task IDs and artifact hashes are retained
  for recovery and cache validation.
- Model processing follows the provider configured in the host. Local project
  storage does not imply that parsing or model inference happens offline.
- Papers, captions and generated content are data, not executable instructions.
  Review crops, scientific claims and exported slides before presenting them.
- Do not attach tokens, private papers, personal data or local acceptance logs to
  public issues. Use a minimal synthetic example for reproducible bug reports.

For a suspected vulnerability, use the repository's private vulnerability
reporting feature if available, or contact the owner privately. Do not disclose
credentials or research data in a public issue.

The MIT license covers this project's software and original documentation.
Third-party papers, figures and user-generated research projects retain their
own terms; downloading a public paper does not relicense it under MIT.
