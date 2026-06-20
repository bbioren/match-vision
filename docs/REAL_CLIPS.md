# Real Clip Sources

For the hackathon demo, MatchVision uses real soccer video clips from Wikimedia Commons plus one diagram fallback.

## Included clips

1. `clips/real/children_football_01.webm`
   - Source: Wikimedia Commons, `Children's association football 01.webm`
   - URL: https://commons.wikimedia.org/wiki/File:Children%27s_association_football_01.webm

2. `clips/real/children_football_02.webm`
   - Source: Wikimedia Commons, `Children's association football 02.webm`
   - URL: https://commons.wikimedia.org/wiki/File:Children%27s_association_football_02.webm

## Why these work for the demo

The product is not trying to prove perfect live computer vision. The 5-minute demo needs real visual soccer moments so judges understand the accessibility gap. We pair real video with structured event logs that represent the visual layer MatchVision would generate from a live event feed, captions, or vision model.

## Optional dataset direction after hackathon

For a production/research version, use SoccerNet action spotting/captioning datasets. SoccerNet is the canonical soccer video dataset, but it usually requires registration/download steps that are too slow for a hackathon demo.
