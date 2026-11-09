Feature: conversion-fidelity-repair

  Scenario: Agent field loss
    Given a Claude agent with skills and tools
    When that config is exported to Cursor
    Then the agent fidelity is lossy and names skills and tools

  Scenario: Command field loss
    Given a Claude command with a description and allowed tools
    When that config is exported to Cursor
    Then the command fidelity is lossy and names description and allowed tools

  Scenario: MCP enabled state loss
    Given an MCP server with an enabled state
    When that config is exported to Cursor
    Then the MCP fidelity is lossy and names enabled

  Scenario: Unverified subagent event
    Given a Claude SubagentStart hook
    When that config is exported to Cursor
    Then the hook fidelity is lossy and names the missing CLI event

  Scenario: Changed permission action is detected
    Given round-trip configs whose permission action changed
    When round-trip loss is calculated
    Then the permission is unaccounted loss

  Scenario: Dropped agent field is detected
    Given round-trip configs whose agent tools were dropped
    When round-trip loss is calculated
    Then the agent is unaccounted unless fidelity is lossy

  Scenario: Forced dry run excludes backup loss
    Given differing generated Cursor files
    When a forced dry run is exported
    Then no fidelity item names a bak path
