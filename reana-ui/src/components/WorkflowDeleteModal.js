/*
  -*- coding: utf-8 -*-

  This file is part of REANA.
  Copyright (C) 2020, 2022, 2023 CERN.

  REANA is free software; you can redistribute it and/or modify it
  under the terms of the MIT License; see LICENSE file for more details.
*/

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Button, Checkbox, Icon, Message, Modal } from "semantic-ui-react";

import { closeDeleteWorkflowModal, deleteWorkflow } from "~/actions";
import client from "~/client";
import { NON_DELETED_STATUSES } from "~/config";
import {
  getWorkflowDeleteModalItem,
  getWorkflowDeleteModalOpen,
} from "~/selectors";

function DeleteWarningMessage({ sizeHumanReadable, hasRelatedRuns }) {
  return (
    <Message icon warning>
      <Icon name="warning circle" />
      <Message.Content>
        <Message.Header>
          Deletion of workspace and interactive sessions!
        </Message.Header>
        This action will delete also the workflow&apos;s workspace
        {sizeHumanReadable ? ` (${sizeHumanReadable})` : ""} and any open
        interactive session attached to it. Please make sure to download all the
        files you want to keep before proceeding.
        {hasRelatedRuns && (
          <>
            <br />
            <br />
            This workflow run is part of a restart chain. Restarted runs share
            the same workspace. Deleting this run would remove the shared
            workspace and leave the other runs in an inconsistent state. If you
            proceed, the related runs will also be marked as deleted.
          </>
        )}
      </Message.Content>
    </Message>
  );
}

function useWorkflowRuns({ open, name, run }) {
  const [state, setState] = useState({
    total: null,
    relatedIds: [],
    loading: false,
  });

  useEffect(() => {
    if (!open || !name) {
      setState({ total: null, relatedIds: [], loading: false });
      return;
    }

    let cancelled = false;
    const selectedFullName = run ? `${name}.${run}` : name;
    const selectedGroup = getWorkspaceGroup(selectedFullName);

    setState((s) => ({ ...s, loading: true }));

    client
      .getWorkflows({
        workflowIdOrName: name,
        status: NON_DELETED_STATUSES,
        // request minimum number of workflows as we are only interested in total
        pagination: { size: 1000, page: 1 },
      })
      .then((resp) => {
        if (cancelled) return;
        const items = resp.data.items || [];
        const relatedIds = selectedGroup
          ? items
              .filter((w) => getWorkspaceGroup(w?.name) === selectedGroup)
              .map((w) => w.id)
              .filter(Boolean)
          : [];
        setState({ total: resp.data.total, relatedIds, loading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        console.log(`Error while fetching runs for workflow ${name}`, err);
        setState({ total: null, relatedIds: [], loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [open, name, run]);

  return state;
}

// Returns the workspace group for a full workflow name
// helloworld-demo.1   -> helloworld-demo.1
// helloworld-demo.1.1 -> helloworld-demo.1
// helloworld-demo.1.2 -> helloworld-demo.1
const getWorkspaceGroup = (fullName) => {
  if (!fullName) return null;
  const parts = String(fullName).split(".");
  let i = parts.length - 1;
  while (i >= 0 && /^\d+$/.test(parts[i])) i--;
  const numeric = parts.slice(i + 1); // ["7","1"]
  const base = parts.slice(0, i + 1).join("."); // "helloworld-demo"
  if (!base || numeric.length === 0) return null;
  return `${base}.${numeric[0]}`; // first numeric suffix = original run
};

export default function WorkflowDeleteModal() {
  const dispatch = useDispatch();
  const open = useSelector(getWorkflowDeleteModalOpen);
  const workflow = useSelector(getWorkflowDeleteModalItem);

  const [allRuns, setAllRuns] = useState(false);
  const [confirmRelatedDeletion, setConfirmRelatedDeletion] = useState(false);

  const { id, name, run, size } = workflow ?? {};
  const { total: allRunsTotal, relatedIds: relatedRunIds } = useWorkflowRuns({
    open,
    name,
    run,
  });

  useEffect(() => {
    // reset local state on workflow change
    setAllRuns(false);
    setConfirmRelatedDeletion(false);
  }, [id, open]);

  const hasRelatedRuns = relatedRunIds.length > 1;
  const showAllRunsCheckbox = Boolean(allRunsTotal && allRunsTotal > 1);

  const onCloseModal = useCallback(() => {
    dispatch(closeDeleteWorkflowModal());
  }, [dispatch]);

  const relatedCount = relatedRunIds?.length;
  const baseRun = String(run ?? "").split(".")[0]; // "7.1" -> "7"
  const runLabel = baseRun ? `${name}#${baseRun}` : name;
  const deleteButtonLabel = useMemo(() => {
    if (!name) return "Delete";
    if (allRuns) return `Delete ${allRunsTotal ?? "all"} runs of "${name}"`;
    if (hasRelatedRuns && confirmRelatedDeletion) {
      return `Delete ${relatedCount || "all"} runs in restart chain of "${runLabel}"`;
    }
    if (run !== undefined && run !== null && String(run) !== "") {
      return `Delete workflow "${name}#${run}"`;
    }
    return `Delete workflow "${name}"`;
  }, [
    allRuns,
    allRunsTotal,
    confirmRelatedDeletion,
    hasRelatedRuns,
    name,
    relatedCount,
    run,
    runLabel,
  ]);

  const onToggleAllRuns = useCallback((_, data) => {
    const checked = Boolean(data.checked);
    setAllRuns(checked);
    // If user opts to delete all runs, related runs are necessarily deleted too
    if (checked) setConfirmRelatedDeletion(true);
  }, []);

  const onDelete = useCallback(async () => {
    if (!id) return;
    // If user selected all runs, keep existing behavior
    if (allRuns) {
      await dispatch(deleteWorkflow(id, { allRuns: true }));
      onCloseModal();
      return;
    }
    // If this run is part of a restart chain, delete workspace once and mark related runs deleted too
    if (hasRelatedRuns) {
      if (!confirmRelatedDeletion) return;
      await dispatch(
        deleteWorkflow(id, { allRuns: false, deleteWorkspace: true }),
      );
      // delete related runs without deleting workspace again
      await Promise.all(
        relatedRunIds
          .filter((otherId) => otherId !== id)
          .map((otherId) =>
            dispatch(
              deleteWorkflow(otherId, {
                allRuns: false,
                deleteWorkspace: false,
              }),
            ),
          ),
      );
      onCloseModal();
      return;
    }

    // normal single run delete
    await dispatch(
      deleteWorkflow(id, { allRuns: false, deleteWorkspace: true }),
    );
    onCloseModal();
  }, [
    allRuns,
    confirmRelatedDeletion,
    dispatch,
    hasRelatedRuns,
    id,
    onCloseModal,
    relatedRunIds,
  ]);

  if (!workflow) return null;

  return (
    <Modal open={open} onClose={onCloseModal} closeIcon size="small">
      <Modal.Header>Delete workflow</Modal.Header>
      <Modal.Content>
        <DeleteWarningMessage
          sizeHumanReadable={size?.human_readable}
          hasRelatedRuns={hasRelatedRuns}
        />
        {hasRelatedRuns && (
          <Checkbox
            label={
              <label>
                Also delete related runs from the restart chain (
                {relatedRunIds.length})
              </label>
            }
            onChange={(_, data) =>
              setConfirmRelatedDeletion(Boolean(data.checked))
            }
            checked={confirmRelatedDeletion}
            disabled={allRuns}
          />
        )}
        {showAllRunsCheckbox && (
          <div style={{ marginTop: hasRelatedRuns ? "0.75rem" : 0 }}>
            <Checkbox
              label={
                <label>
                  Delete all the runs of the workflow{" "}
                  {allRunsTotal ? `(${allRunsTotal})` : ""}
                </label>
              }
              onChange={onToggleAllRuns}
              checked={allRuns}
            />
          </div>
        )}
      </Modal.Content>
      <Modal.Actions>
        <Button
          negative
          disabled={hasRelatedRuns && !allRuns && !confirmRelatedDeletion}
          onClick={onDelete}
        >
          {deleteButtonLabel}
        </Button>
        <Button onClick={onCloseModal}>Cancel</Button>
      </Modal.Actions>
    </Modal>
  );
}
