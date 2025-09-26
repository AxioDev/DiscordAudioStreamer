# DiscordAudioStreamer

## Configuration

The application uses environment variables (loaded via [dotenv](https://github.com/motdotla/dotenv)) to control its behaviour.

### Excluding users from the audio mix

Use the `EXCLUDED_USER_IDS` environment variable to provide a comma-separated list of Discord user IDs that should be ignored by the audio bridge and speaker tracking logic. If the variable is not provided, the application excludes the user `1419381362116268112` by default.

```env
# Example: ignore multiple users
EXCLUDED_USER_IDS=1419381362116268112,123456789012345678
```

You can clear the default exclusion by explicitly setting the variable to an empty value in your environment (e.g. `EXCLUDED_USER_IDS=` in your `.env` file).
