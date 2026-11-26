---
title: "Why?"
shortTitle: "Why?"
slug: preface
order: 0
description: "Why build this?"
---

## A Rant

I contemplated where to start writing about this project. I could start with talking about how I believe Apple has still dropped the ball on iOS/MacOS search. I could talk about what I see as the problem, and my vision for this project, the features, the engineering problems that I found interesting, the elements that I wanted to learn about. I will talk about all this at some point in this blog section.

However, before diving in, I actually want to zoom out even more though and just talk about why I did this. Why did I devote hours and hours over weeks and months (and eventually a year) to build this. I lost time with my girlfriend and friends, sleep, etc. For the past six months even at [Rebar][rebar], I've had some background thread going about needing to "finalize" this project.

You can argue that it's a me thing, but I would argue this is emblematic of the state of software engineering that's going on. Every single fucking day. Every post on LinkedIn or Twitter screaming about automation around engineering and AGI being right around the corner. [Engineers][eng-fatigue-pt1] [are getting][eng-fatigue-pt2] [squeezed][eng-fatigue-pt3] because the barrier to entry has never been lower. I text my buddy and send him an article about engineering fatigue in the age of AI and he says, "wdym" and sends me back a screenshot of him utilizing CC to orchestrate an agent team to conduct an audit of a new auth feature that he's been working on. [My best friend from pre-k][henry] is showing me new mobile apps he's running as debug builds on his phone. This is the status quo. The pressure - both existentially and societally - is immense. I'll rant more on substack about my thoughts around time to last token in the age of ai, but god damn. It is exhausting and exhilarating at the same time.

<!-- My friends from former jobs and my peers from Swarthmore are raising 100M Series A's or being millionaire minted at leading AI labs.  -->

The only reason that I even was able to finally do this is because I had a bit of time in between jobs and then ~six weekends later~ finally after getting three more days on vacation, i've finally succumb to the idea that this is really just an MVP. And that being said, I realize that this started as a research project and that it cannot be perfect. I could probably spend years working on this project, from diving into the `mlx` architecture or exploring fine-tuning, or researching applications of TurboQuant or doing more rigorous evals, etc etc. And perhaps I will spend those years doing that.... But not before this release.

## The Problem and the Vision

Let's first talk about Apple and why I do legitimately believe that this is a worthwhile application. I wrote this back in February and months have passed. Turns out I would have been wrong:

> Let me also call my shot here and say that it's February 15th as I write this. I'm on a flight to Peru with my best friend from college. I think this problem is moot by September. So yeah, I probably shouldn't have spent ~~3mo~~ 5mo (it's now April 8th) on it.

I think Apple will eventually have this push and have locally chunked vector embeddings of messages, or even just an on-device agent that has access to clean tools for interacting with iMessages, but either way, I'll be very interested to see their implementation of it. I am borderline confident that they won't be utilizing `duckdb` and that they won't be referencing a Karpathy quote in any marketing material though.

### Personal Motivation

As of right now, I'd argue that Apple search sucks. I do not think I'm alone in this take - it [objectively][apple-search-pt1] [sucks][apple-search-pt2]. We're ["near the end of the exponential" as Dario threw out casually](https://www.youtube.com/watch?v=n1E9IZfvGMA), there is a double digit percent chance that ASI ends humanity as a whole, and yet, I can't ask my iMessages "hey what's the last restaurant I went to?" I have limited insights about the topics and analytics that I'm curious about.

So yeah I could justify the project here, but really at the end of the day... why build this? I am deeply interested in a lot of the engineering here so it really was to explore local models, try out duckdb's VSS extension, desperately attempt to learn more about good Rust paradigms, and push myself to build something.

### Why `Be Right Back`?

Two fold... One `brb` is a common texting abbreviation, so it's a bit tongue-in-cheek there. That rationale is light and playful.

The second is more serious. I have seen many many examples over the last 6 months of artifacts that are representative of Black Mirror. And as an impressionable young teenager, I remember watching an episode called ["Be Right Back"][black-mirror-brb]. You should watch the episode but the premise is that a woman becomes a widow and a posthumous AI clone is there for her. It's dystopian and dark, and I do see no reason why we're not hurtling towards that reality within years. There are numerous examples:

- [ai clone company #1][dystopian-comp1]
- [ai clone company #2][dystopian-comp2]
- [ai clone company #3][dystopian-comp3]

**Before I get doxed, I am NOT implementing core cloning features of that for the general public**. I will you generate a "You" persona that trains on your own outgoing message style and all of that, but you will not be able to finetune on a peer's messages without their consent. I need to solve a consent and opt in problem, that transparently I do not think I'm going to be able to solve given time constraints. And that is the part that is critical.

So what I'm really hoping for is that when you search, "be right back" or pull up this project, or eventually use the cli and say `brb chat ...` you think about those characters you're typing and are reminded of that episode, this project, and the dangers that we're all rocketing towards as Dario (and many of my friends) [mint millions and billions](https://www.cnn.com/2026/11/19/tech/anthropic-employees-now-millionaires) in the AI boom.

### Privacy Concerns

In my opinion, your iMessage data is some of the most critical data that you have. This is about human relationships (I guess some / most of you at this point will have Moltbot / Openclaw / sub in their new name) open access to your iMessages and it'll probably be reading this project and maybe even fielding iMessages for you. Sure sure, it's closed source and running on your mac mini, that's awesome. Just be very careful your data.

The whole point of this project (besides the super fun engineering effort about how to run a high quality local agent efficiently) is to **respect your data!!!** You have it on my word that none of your iMessages after ingesting your imessages leave your device. Literally after installing and then downloading the pertinent Huggingface artifacts, you should be able to shut off your wifi and still interact with the app as you wish.

That is a point I will reiterate throughout the blog.

---

Ok rant is over, let's move onto the actual product.

[comment]: <> (Bibliography)
[apple-search-pt1]: https://www.reddit.com/r/iphone/comments/1rc8p2g/imessage_search_function/
[apple-search-pt2]: https://discussions.apple.com/thread/256197498?sortBy=rank
[henry]: https://jebhenryhead.com/
[eng-fatigue-pt1]: https://www.businessinsider.com/ai-fatigue-burnout-software-engineer-essay-siddhant-khare-2026-2
[eng-fatigue-pt2]: https://letsdatascience.com/news/software-engineers-feel-exhausted-by-ai-agents-19115894
[eng-fatigue-pt3]: https://www.reddit.com/r/BetterOffline/comments/1r2fgd6/i_an_engineer_tired_of_being_forcefed_ai_tools_by/
[black-mirror-brb]: https://en.wikipedia.org/wiki/Be_Right_Back
[end-of-exp]: https://www.youtube.com/watch?v=n1E9IZfvGMA
[dystopian-comp1]: https://www.delphi.ai/
[dystopian-comp2]: https://www.inc.com/ben-sherry/viven-says-ai-clones-of-your-employees-will-boost-productivity-heres-how/91253251
[dystopian-comp3]: https://www.reddit.com/r/STEW_ScTecEngWorld/comments/1owliqk/an_ai_company_has_released_an_app_that_lets/
[rebar]: https://www.withrebar.ai