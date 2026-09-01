# Automation safety

RCC includes independent Sell and Spawner automation modules. Both are opt-in and support schedules, previews, cancellation and per-account configuration.

Before enabling automation on a real server:

1. Read the server rules and confirm that console clients and automation are allowed.
2. Use **Preview without clicks**.
3. Test with an unimportant inventory while supervising the first run.
4. Verify GUI titles, item IDs and configured control slots from RCC diagnostics.
5. Keep Arrow Guard and the emergency stop enabled.

Server GUIs can change without notice. RCC fails closed when expected windows, slots or items do not match the configured safety checks.
