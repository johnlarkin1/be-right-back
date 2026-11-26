---
title: "The Problem & Vision"
shortTitle: "Problem & Vision"
slug: problem-vision
order: 1
description: "Why build a local-first AI persona app? The inspiration, motivation, and ethical considerations."
---

## What We're Building

Ok so most likely you skipped through that [preface] pretty quick. That's ok that's fine, let's talk about what we're actually building.

This is a local MacOS (sorry windows / linux users) Tauri desktop application. It should be ~150MB. It has numerous features but within it, it holds a local agent that knows how to interact and search your iMessages. This is not sniffing the Ollama space and this is not meant to be a bring-your-own-local-model application. BRB is meant to give you a better understanding into your relationship with your peers, show interesting texting patterns and analytics, and overall just be a helpful tool for visualizing and _self-reflection_. That's really what I want - people to be able to answer questions about their lives in a safe and secure way, gain better insights, and have fun using this application.

## Core Features

We have these as the features I want to highlight:

- **local-first**: all data and processing happens on your mac. no cloud, no external servers, messages stay private
- **iMessage integration**: indexes and understands your iMessages, enabling advanced search, semantic queries, natural language Q&A
- **convo analytics**: visualize your text patterns as the illustrious Github Activity heatmap, message freq, response times, etc etc
- **casper agent**: interact with an agent that can help you answer daily questions
- **performant**: lightweight application, downloads weights on the fly, won't burn out your vram
- **secure**: again, your data is your data

## Architecture

The system design now has its own chapter: [System Design][system-design].

[comment]: <> (Bibliography)
[preface]: /how-its-built/preface
[system-design]: /how-its-built/system-design
