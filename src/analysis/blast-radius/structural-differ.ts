import { StructuralNode } from '../../languages/types';
import { SymbolChange } from './blast-types';

export class StructuralDiffer {
  /**
   * Compares baseline/previous AST structural nodes against current nodes
   * to detect deleted, renamed, signature-changed, and added symbols.
   */
  public diffNodes(
    previousNodes: readonly StructuralNode[],
    currentNodes: readonly StructuralNode[]
  ): readonly SymbolChange[] {
    const changes: SymbolChange[] = [];

    const prevByKindAndName = new Map<string, StructuralNode>();
    for (const node of previousNodes) {
      prevByKindAndName.set(`${node.kind}::${node.name}`, node);
    }

    const currByKindAndName = new Map<string, StructuralNode>();
    for (const node of currentNodes) {
      currByKindAndName.set(`${node.kind}::${node.name}`, node);
    }

    const unmatchedPrev: StructuralNode[] = [];
    const unmatchedCurr: StructuralNode[] = [];

    // 1. Identify identical or signature-changed symbols
    for (const [key, prevNode] of prevByKindAndName) {
      const currNode = currByKindAndName.get(key);
      if (currNode) {
        // Compare signatures / details
        if (
          prevNode.details &&
          currNode.details &&
          prevNode.details.trim() !== currNode.details.trim()
        ) {
          changes.push({
            name: currNode.name,
            kind: currNode.kind,
            changeKind: 'signature-changed',
            oldNode: prevNode,
            newNode: currNode,
            details: `Signature changed from '${prevNode.details.trim()}' to '${currNode.details.trim()}'.`,
            line: currNode.startLine,
          });
        }
      } else {
        unmatchedPrev.push(prevNode);
      }
    }

    for (const [key, currNode] of currByKindAndName) {
      if (!prevByKindAndName.has(key)) {
        unmatchedCurr.push(currNode);
      }
    }

    // 2. Identify renamed symbols: same kind, similar line or identical signature details
    const remainingPrev: StructuralNode[] = [];
    const remainingCurr = [...unmatchedCurr];

    for (const prev of unmatchedPrev) {
      let matchedIdx = -1;

      // First try matching by identical signature details and same kind
      if (prev.details && prev.details.length > 5) {
        matchedIdx = remainingCurr.findIndex(
          c => c.kind === prev.kind && c.details === prev.details
        );
      }

      // If no match by exact details, match by same kind if parameter signature matches
      // or if names share common prefix/suffix within 3 lines
      if (matchedIdx < 0 && prev.name.length >= 3) {
        matchedIdx = remainingCurr.findIndex(c => {
          if (c.kind !== prev.kind) {
            return false;
          }
          if (prev.details && c.details) {
            const prevSigWithoutName = prev.details.replace(prev.name, '').trim();
            const currSigWithoutName = c.details.replace(c.name, '').trim();
            if (prevSigWithoutName.length > 5 && prevSigWithoutName === currSigWithoutName) {
              return true;
            }
          }
          if (Math.abs(c.startLine - prev.startLine) <= 3) {
            const suffixLen = Math.min(4, Math.floor(prev.name.length / 2));
            const hasCommonSuffix =
              suffixLen >= 3 &&
              prev.name.slice(-suffixLen).toLowerCase() === c.name.slice(-suffixLen).toLowerCase();
            const hasCommonPrefix =
              suffixLen >= 3 &&
              prev.name.slice(0, suffixLen).toLowerCase() === c.name.slice(0, suffixLen).toLowerCase();
            return hasCommonSuffix || hasCommonPrefix;
          }
          return false;
        });
      }

      if (matchedIdx >= 0 && remainingCurr[matchedIdx]) {
        const renamedTo = remainingCurr.splice(matchedIdx, 1)[0]!;
        changes.push({
          name: prev.name,
          kind: prev.kind,
          changeKind: 'renamed',
          oldNode: prev,
          newNode: renamedTo,
          details: `Symbol '${prev.name}' appears renamed to '${renamedTo.name}'.`,
          line: renamedTo.startLine,
        });
      } else {
        remainingPrev.push(prev);
      }
    }

    // 3. Any remaining unmatched in prev are DELETED
    for (const deleted of remainingPrev) {
      changes.push({
        name: deleted.name,
        kind: deleted.kind,
        changeKind: 'deleted',
        oldNode: deleted,
        details: `Symbol '${deleted.name}' (${deleted.kind}) was removed.`,
        line: deleted.startLine,
      });
    }

    // 4. Any remaining in curr are ADDED
    for (const added of remainingCurr) {
      changes.push({
        name: added.name,
        kind: added.kind,
        changeKind: 'added',
        newNode: added,
        details: `Symbol '${added.name}' (${added.kind}) was introduced.`,
        line: added.startLine,
      });
    }

    return changes;
  }
}
