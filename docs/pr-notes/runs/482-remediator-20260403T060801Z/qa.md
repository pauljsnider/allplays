# QA Role Notes

- Manual validation target: attempt config deletion with one local game referencing the config and with one shared game referencing the config.
- Expected result: both cases throw the existing "still assigned" error and do not delete the config.
- Regression check: deleting an unused config should still succeed.
- Repo guidance indicates no automated test runner; validation will rely on targeted code inspection plus any lightweight manual/static checks available.
