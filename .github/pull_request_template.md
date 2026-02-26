## Summary
- What changed:
- Why it changed:

## Code Review Checklist
- [ ] Logic reviewed for regressions and edge cases
- [ ] API request/response behavior reviewed
- [ ] Security impact reviewed (auth, validation, secrets)
- [ ] Performance impact reviewed (hot paths, loops, network calls)

## QA Checklist (Required)
- [ ] `npm --prefix enigma run build`
- [ ] `npm --prefix enigma test`
- [ ] `npm --prefix enigma run qa:extended`
- [ ] Manual UI pass for changed pages/features

## Deployment Checklist
- [ ] ENV values confirmed for target environment
- [ ] `ENIGMA_JWT_SECRET` set (non-default)
- [ ] Rollback plan included
- [ ] Monitoring/alerts verified after deploy

## Risks / Follow-ups
- Known risks:
- Follow-up tasks:
