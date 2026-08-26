# Schoolium

Schoolium — продукт экосистемы Flōr для управления школьными рабочими пространствами; аутентификация и межпродуктовые связи идентичностей предоставляются отдельным IDP.

- Criticality: Tier 1 (целевой IDP — отдельный Tier 0 компонент)
- Owner: Schoolium Architecture
- Documentation: [docs/index.md](docs/index.md)
- Local setup: [docs/11-onboarding.md](docs/11-onboarding.md)

## Local development

```bash
npm install
npm run dev:idp        # OIDC discovery on :4000, group API on :4001
npm run dev:schoolium  # Schoolium API on :3000
npm test
```

The runnable services are intentionally development-only until the unresolved owner decisions in [docs/risks.md](docs/risks.md) are accepted. Production startup is refused instead of silently using in-memory identities, headers, or keys.
