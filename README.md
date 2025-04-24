# syllabl

A daily word puzzle game that challenges players to stretch their vocabulary by finding words containing specific 3-letter strings while following syllable count and placement rules.

## Game Overview

In syllabl, every puzzle is built around a fixed 3-letter string that must appear in all answers. Each puzzle has six levels, and each level gives you two constraints:

1. **Placement Rule** — where the string must appear in your word:
   - Beginning
   - End
   - Both
   - Somewhere in the middle

2. **Syllable Count** — how many syllables the word must contain

The goal is to get your score as high as possible for each puzzle. Rarer words = more points (5 for the rarest). Think creatively, avoid common words, and aim for linguistic obscurity.

## Features

- **Daily Puzzle**: A new challenge every day
- **Shuffle Mode**: Random puzzles for endless play
- **Custom Puzzles**: Create and share your own puzzles
- **Statistics**: Track your performance
- **Multiple Themes**: Choose from 8 visual styles
- **Responsive Design**: Play on any device

## Technical Stack

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: AWS Lambda
- **APIs**:
  - Merriam-Webster Collegiate API (word validation)
  - Datamuse API (word frequency)
- **Database**: AWS DynamoDB (leaderboard)

## Project Structure

- `index.html`: Main game interface
- `style.css`: Core styling
- `themes.css`: Theme system
- `script.js`: Game logic and UI interactions
- `index.mjs`: Lambda handler for word validation
- `leaderboardHandler.mjs`: Lambda handler for leaderboard
- `puzzles.json`: Master puzzle list
- `shuffled_puzzles.json`: Daily puzzle rotation
- `feedback.json`: Game feedback messages

## Theme System

The game includes 8 visual themes:
1. Light (default)
2. Dark
3. Forest
4. Lilac
5. Banana
6. Garnet
7. Fuchsia
8. Peachy

Each theme defines a complete color palette for:
- Background colors
- Text colors
- Accent colors
- Word frequency colors
- Button colors

## Puzzle System

Each puzzle consists of:
- A 3-letter string
- 6 levels of increasing difficulty
- Placement rules for each level
- Required syllable counts for each level

## Scoring System

Words are scored based on frequency:
- 1 point: Very common words
- 2 points: Common words
- 3 points: Notable words
- 4 points: Impressive words
- 5 points: Extremely rare words

## Development

### Prerequisites
- Node.js
- AWS account (for deployment)
- Merriam-Webster API key
- Datamuse API access

### Setup
1. Clone the repository
2. Install dependencies
3. Set up environment variables
4. Deploy to AWS Lambda

### Environment Variables
- `MW_API_KEY`: Merriam-Webster API key
- `DYNAMODB_TABLE`: DynamoDB table name

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Merriam-Webster for word validation
- Datamuse for word frequency data
- AWS for hosting infrastructure 