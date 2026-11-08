import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSun, faMoon } from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import parseExcelJobSummary from "./utils/parseExcelJobSummary";
import ExcelJobSummaryDisplay from "./components/ExcelJobSummaryDisplay";
import parseGridCallouts from "./utils/parseGridCallouts";

function calculatePoleStats(parsedData) {
  let totalPoles = 0;
  let changedOutPoles = 0;
  let apcWorkedPoles = 0;
  let midspanPoles = 0;
  let apcNonPco = 0;
  parsedData.forEach((item) => {
    totalPoles += 1;

    if (
      item.proposedPoleSpec !== "N/A" &&
      item.constructionNotesFormatted.toUpperCase().includes("POLE") &&
      item.constructionNotesFormatted.toUpperCase().includes("RM")
    ) {
      changedOutPoles += 1;
    }
    if (
      (item.constructionNotesFormatted.toUpperCase().includes("GPS") ||
        item.constructionNotesFormatted
          .toUpperCase()
          .includes("SET NEW POLE") ||
        item.poleTag.toUpperCase().includes("NEW POLE")) &&
      item.proposedPoleSpec !== "N/A"
    ) {
      midspanPoles += 1;
    }
    if (
      item.attacherCompany &&
      item.attacherCompany.includes("Alabama Power")
    ) {
      apcWorkedPoles += 1;
    }
    apcNonPco = apcWorkedPoles - changedOutPoles - midspanPoles;
  });

  return {
    totalPoles,
    changedOutPoles,
    apcWorkedPoles,
    apcNonPco,
    midspanPoles,
  };
}

function App() {
  const [parsedData, setParsedData] = useState([]);
  const [isJsonUploaded, setIsJsonUploaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [darkMode, setDarkMode] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [copiedNjunsIndex, setCopiedNjunsIndex] = useState(null);
  const [copiedToCrewIndex, setCopiedToCrewIndex] = useState(null);
  const [hideNoWork, setHideNoWork] = useState(true);
  const [excelOutput, setExcelOutput] = useState("");
  const [parsedExcelData, setParsedExcelData] = useState([]);
  const jobStats = calculatePoleStats(parsedData);
  const [excelJobSummary, setExcelJobSummary] = useState(null);
  const [isGPC, setIsGPC] = useState(false);
  const [isGrid, setIsGrid] = useState(false);

  // Function to toggle dark mode
  const handleToggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  const handleToggleHideNoWork = () => {
    setHideNoWork(!hideNoWork);
  };

  function formattedConstructionNotes(note) {
    const lines = note.split("\n");

    let formattedLines = [];

    const keywords = ["RM:", "IN:", "TX:"];

    let currentKeyword = "";
    let addSpacing = false;

    for (let i = 0; i < lines.length; i++) {
      let trimmedLine = lines[i].trim();

      if (keywords.some((keyword) => trimmedLine.startsWith(keyword))) {
        currentKeyword = trimmedLine.split(":")[0] + ":";
        const nextLine = lines[i + 1]?.trim();
        formattedLines.push(`${currentKeyword} ${nextLine}`);

        addSpacing = true;

        i++;
      } else if (
        addSpacing &&
        (currentKeyword === "RM:" || currentKeyword === "TX:")
      ) {
        if (trimmedLine.startsWith("*") || trimmedLine === "") {
          addSpacing = false;
          formattedLines.push(trimmedLine);
        } else {
          formattedLines.push("       " + trimmedLine);
        }
      } else if (addSpacing && currentKeyword === "IN:") {
        if (trimmedLine.startsWith("*") || trimmedLine === "") {
          addSpacing = false;
          formattedLines.push(trimmedLine);
        } else {
          formattedLines.push("     " + trimmedLine);
        }
      } else {
        formattedLines.push(trimmedLine);
      }
    }

    let formattedString = formattedLines.join("\n");

    formattedString = formattedString.replace(/(\n{2,})/g, "\n");

    formattedString = formattedString.replace(
      /(TX:[^\n]*\n(?:\s+.*\n)*)/g,
      "$1\n"
    );

    formattedString = formattedString.trimEnd();

    return formattedString;
  }

  function formatMultiline(label, text, indent, isStar = false) {
    const lines = text.split(/\r?\n/);
    return lines.map((line, idx) => {
      if (isStar) {
        return `*${indent}${line}`;
      }
      return idx === 0 ? `${label}: ${line}` : `${indent}${line}`;
    });
  }

  const handleDrop = async (
    event,
    setParsedData,
    setIsJsonUploaded,
    setErrorMessage,
    setJobNumber,
    setExcelOutput,
    setParsedExcelData
  ) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    const fileName = file.name;
    const isJson = file && file.type === "application/json";
    const isExcel =
      fileName.endsWith(".xlsx") ||
      fileName.endsWith(".xls") ||
      fileName.endsWith(".csv");

    if (isJson) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const jsonString = e.target.result;
          const json = JSON.parse(jsonString);
          const jobNumber = json.name || "Default Job Name";
          setJobNumber(jobNumber);

          const isNodeStructure = !!json.nodes;
          const isConnectionStructure = !!json.connections;

          const data = [];
          const errors = [];

          if (isNodeStructure) {
            const nodes = json.nodes;
            Object.keys(nodes).forEach((nodeId) => {
              const node = nodes[nodeId];
              const attributes = node.attributes;

              try {
                const nodeType =
                  attributes?.node_type?.["-Imported"] ||
                  attributes?.node_type?.["multi_added"] ||
                  attributes?.node_type?.["button_added"] ||
                  Object.values(attributes.node_type)[0] ||
                  "N/A";

                if (nodeType?.toLowerCase() !== "pole") return;

                const poleOwner =
                  Object.values(attributes.pole_owner)[0] ||
                  attributes?.pole_owner?.["-Imported"] ||
                  "N/A";

                const poleCount =
                  attributes?.pole_count?.["-Imported"] ||
                  Object.values(attributes.pole_count)[0] ||
                  "error with data";
                const poleTag =
                  attributes?.pole_tag?.["-Imported"]?.tagtext ||
                  Object.values(attributes.pole_tag)[0]?.tagtext ||
                  "N/A";
                const constructionNotes =
                  Object.values(attributes?.construction_notes || {})
                    .filter((note) => note.attacher === "Alabama Power")
                    .map((note) => note.note)
                    .join(", ") || "NO APC WORK";

                const constructionNotesFormatted =
                  formattedConstructionNotes(constructionNotes);

                const attacherCompany =
                  Object.values(attributes?.construction_notes || [])
                    .map((note) => note.attacher)
                    .filter((attacher) => attacher)
                    .join(", ") || "N/A";

                const proposedPoleSpec =
                  attributes?.proposed_pole_spec?.["button_added"] ||
                  attributes?.proposed_pole_spec?.["-Imported"] ||
                  "N/A";

                const poleLatLong =
                  node?.latitude + ", " + node.longitude ||
                  Object.values(node?.latitude)[0] +
                    ", " +
                    Object.values(node.longitude)[0] ||
                  "N/A";

                const keyword = "NESC";
                const poleJuCompanies =
                  Object.values(attributes?.construction_notes || {})
                    .filter((note) =>
                      note.note?.toLowerCase().includes(keyword.toLowerCase())
                    )
                    .map((note) =>
                      note.attacher === ""
                        ? "Missing JU transfer company"
                        : note.attacher
                    )
                    .filter((company) => company) || "N/A";

                data.push({
                  id: nodeId,
                  type: nodeType,
                  poleOwner,
                  poleCount,
                  poleTag,
                  constructionNotes,
                  attacherCompany,
                  proposedPoleSpec,
                  poleLatLong,
                  poleJuCompanies,
                  constructionNotesFormatted,
                  // njunsData
                });
              } catch (error) {
                errors.push(`Issue with attributes for node ID: ${nodeId}`);
                console.error(`Error processing node ID ${nodeId}:`, error);
              }
            });
          } else if (isConnectionStructure) {
            const connections = json.connections;
            Object.keys(connections).forEach((connectionId) => {
              const connection = connections[connectionId];
              const attributes = connection.attributes;

              try {
                const connectionType =
                  attributes?.connection_type?.["button_added"] || "N/A";

                if (connectionType !== "aerial cable") return;

                const poleCount =
                  attributes?.pole_count?.["-Imported"] ||
                  Object.values(attributes.pole_count)[0] ||
                  "error with data";
                const poleTag =
                  attributes?.pole_tag?.["-Imported"]?.tagtext || "N/A";
                const constructionNotes =
                  Object.values(attributes?.construction_notes || {})
                    .filter((note) => note.attacher === "Alabama Power")
                    .map((note) => note.note)
                    .join(", ") || "N/A";

                data.push({
                  id: connectionId,
                  type: connectionType,
                  poleCount,
                  poleTag,
                  constructionNotes,
                });
              } catch (error) {
                errors.push(
                  `Issue with attributes for connection ID: ${connectionId}`
                );
                console.error(
                  `Error processing connection ID ${connectionId}:`,
                  error
                );
              }
            });
          } else {
            setErrorMessage("Unrecognized JSON structure");
          }

          // Sort the data by pole count, including handling decimal values
          data.sort((a, b) => {
            const poleCountA = parseFloat(a.poleCount) || 0;
            const poleCountB = parseFloat(b.poleCount) || 0;
            return poleCountA - poleCountB;
          });

          setParsedData(data);
          setErrorMessage(errors.join(" | "));
          setIsJsonUploaded(true);
        } catch (error) {
          console.error("Error parsing JSON", error);
          setErrorMessage("Error parsing JSON file.");
        }
      };
      reader.readAsText(file);
    } else if (isExcel) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      //Flags to determine which job type
      const gpcFlag = (sheet.H1?.v || sheet.I1?.v || "")
        .toString()
        .toUpperCase()
        .includes("GPC");
      setIsGPC(gpcFlag);
      const gridFlag = (sheet.H1?.v || sheet.I1?.v || "")
        .toString()
        .toUpperCase()
        .includes("GRID");
      setIsGrid(gridFlag);
      // const calloutSheet =
      //   workbook.Sheets["Callout Template"] || workbook.Sheets["Sheet1"];
      // const calloutRowsRaw = XLSX.utils.sheet_to_json(calloutSheet, {
      //   defval: "",
      // });
      // const calloutRows = calloutRowsRaw.map((row) => ({
      //   location: row["LOC #"] || row["Location"] || "",
      //   rm: row["REMOVALS"] || row["RM"] || "",
      //   in: row["INSTALLS"] || row["IN"] || row["Install"] || "",
      //   tx: row["TRANSFERS"] || row["TX"] || "",
      //   notes:
      //     row["SPEC/NOTES"] ||
      //     row["Note/Spec"] ||
      //     row["Notes"] ||
      //     row["Spec"] ||
      //     "",
      // }));
if (gridFlag) {
  const { structured, output } = parseGridCallouts(rows, formatMultiline);

  setParsedExcelData(structured);
  setExcelOutput(output);
  setIsGPC(true); // Ensures GRID output matches GPC formatting
  return;

    };

      // const boreSheet = workbook.Sheets["Bore"];
      // const boreData = {
      //   primaryUG: Number(boreSheet?.D4?.v || 0),
      //   secondaryUG: Number((boreSheet?.P4?.v || 0) + (boreSheet?.H4?.v || 0)),
      //   serviceUG: Number((boreSheet?.L4?.v || 0) + (boreSheet?.T4?.v || 0)),
      //   totalBoreFootage: Number(boreSheet?.AC3?.v || boreSheet?.AC4?.v || 0),
      // };

      // const parsedExcelData = {
      //   "Callout Template": calloutRows,
      //   Bore: boreData,
      // };

      // --- NJUNS sheet parsing ---
      const njunsSheet = workbook.Sheets["NJUNS"];
      let njunsByLoc = new Map();

      if (njunsSheet) {
        const njunsRows = XLSX.utils.sheet_to_json(njunsSheet, {
          header: 1,
          defval: "",
        });

        const startIdx =
          njunsRows.length > 0 &&
          typeof njunsRows[0][0] === "string" &&
          /njuns|number|id/i.test(njunsRows[0][0])
            ? 1
            : 0;

        for (let i = startIdx; i < njunsRows.length; i++) {
          const row = njunsRows[i] || [];
          const njunsNum = (row[0] ?? "").toString().trim();
          const locValue = (row[2] ?? "").toString().trim();

          if (njunsNum && locValue) {
            njunsByLoc.set(locValue, njunsNum);
          }
        }
      }

      const jobSummary = parseExcelJobSummary(parsedExcelData);
      setExcelJobSummary(jobSummary);

      let structured = [];
      let lines = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const location = row[0]?.toString().trim();
        const tag = row[1]?.toString().trim();
        const rm = row[2]?.toString().trim();
        const install = row[3]?.toString().trim();
        const tx = row[4]?.toString().trim();
        const note = row[5]?.toString().trim();
        const toCrew = row[6]?.toString().trim() || ""; // Column G
        const toGis = row[7]?.toString().trim() || ""; // Column H

        const hasContent = rm || install || tx || note;
        if (!location || !hasContent) continue;

        let callouts = [];
        let outputLines = [];

        let displayTag = "";
        let trimmedTag = tag?.trim() || "";
        const poleTagPattern = /^[1-4]-\d+$/;
        const matchedNjuns = njunsByLoc.get(location) || "";

        if (trimmedTag && poleTagPattern.test(trimmedTag)) {
          displayTag = `POLE TAG# ${trimmedTag}`;
        } else {
          displayTag = trimmedTag; // this could still be empty or "INSTALL T# 123" etc.
        }

        if (isGPC || isGrid) {
          outputLines.push(`**WL ${location}**`);
        } else {
          outputLines.push(
            `LOC ${location}${displayTag.trim() ? ` - ${displayTag}` : ""}`
          );
        }
        if (isGPC || isGrid) {
          outputLines.push(""); // Blank line between WL and notes
        }
        // outputLines.push(
        //   // `LOC ${location}${displayTag.trim() ? ` - ${displayTag}` : ""}`
        // );

        // Add LOC line with or without tag based on content

        if (rm) {
          const rmLines = formatMultiline("RM", rm, "        ");
          callouts.push(...rmLines);
          outputLines.push(...rmLines);
        }
        if (install) {
          const inLines = formatMultiline("IN", install, "      ");
          callouts.push(...inLines);
          outputLines.push(...inLines);
        }
        if (tx) {
          const txLines = formatMultiline("TX", tx, "       ");
          callouts.push(...txLines);
          outputLines.push(...txLines);
        }

        if (note) {
          callouts.push(""); // ➕ Add blank line before notes
          outputLines.push(""); // ➕ Add blank line before notes
          const noteLines = note.replace(/\r/g, "").split("\n");

          noteLines.forEach((line) => {
            const trimmed = line.trim();

            if (!trimmed) {
              // Preserve intentional blank lines
              callouts.push("");
              outputLines.push("");
              return;
            }

            const formattedLine = trimmed.startsWith("*")
              ? trimmed
              : `*${trimmed}`;
            callouts.push(formattedLine);
            outputLines.push(formattedLine);
          });
        }

        outputLines.push(""); // Blank line for spacing
        lines.push(...outputLines); // Add this location's formatted output to final list

        structured.push({
          poleCount: location,
          poleTag: displayTag,
          constructionNotes: [rm, install, tx, note].filter(Boolean).join(", "),
          constructionNotesFormatted: callouts.join("\n"),
          njunsNumber: matchedNjuns,
          gText: toCrew,
          hText: toGis,
        });
      }
      setParsedExcelData(structured);
      setExcelOutput(lines.join("\n"));
    }
  };

  const handleCopy = (text, index) => {
    const capitalizedText = text.toUpperCase();
    navigator.clipboard.writeText(capitalizedText);

    if (index >= 0) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    }
  };

  const handleNjunsCopy = (text, index) => {
    const capitalizedText = text.toUpperCase();
    navigator.clipboard.writeText(capitalizedText);

    if (index >= 0) {
      setCopiedNjunsIndex(index);
      setTimeout(() => setCopiedNjunsIndex(null), 1500);
    }
  };

  const handleToCrewCopy = (text, index) => {
    const capitalizedText = text.toUpperCase();
    navigator.clipboard.writeText(capitalizedText);

    if (index >= 0) {
      setCopiedToCrewIndex(index);
      setTimeout(() => setCopiedToCrewIndex(null), 1500);
    }
  };

  // const handleDownloadPDF = () => {
  //   const doc = new jsPDF();
  //   const margin = 10;
  //   const lineHeight = 6;
  //   const pageHeight = doc.internal.pageSize.height;

  //   doc.setFontSize(10);
  //   let y = margin;

  //   parsedExcelData.forEach((item) => {
  //     const lines = (
  //       (isGPC
  //         ? `WL ${item.poleCount}${
  //             item.poleTag.trim() ? `\n${item.poleTag}` : ""
  //           }\n\n`
  //         : `LOC ${item.poleCount}${
  //             item.poleTag.trim() ? ` - ${item.poleTag}` : ""
  //           }\n\n`) + item.constructionNotesFormatted
  //     ).split("\n");
  //     const blockHeight = (lines.length + 3) * lineHeight;

  //     if (y + blockHeight > pageHeight) {
  //       doc.addPage();
  //       y = margin;
  //     }

  //     lines.forEach((line) => {
  //       doc.text(line, margin, y);
  //       y += lineHeight;
  //     });

  //     y += 2;
  //     doc.setDrawColor(150);
  //     doc.line(margin, y, doc.internal.pageSize.width - margin, y);
  //     y += 4;
  //   });

  //   doc.save("locations_output.pdf");
  // };

  return (
    <div
      className={`min-h-screen flex flex-col ${
        darkMode ? "bg-custom-gray text-white" : "bg-gray-100 text-gray-900"
      }`}
    >
      {/* Header */}
      <header
        className={`py-4 px-8 shadow-md flex justify-between items-center ${
          darkMode ? "bg-custom-gray" : "bg-blue-600 text-white"
        }`}
      >
        <div>
          <h1 className="text-xl font-semibold">MMU Parser</h1>
          <span className="font-semibold text-xs">by West Zone Engineering Team</span>
        </div>
        <div className="flex items-center">
          {jobNumber && (
            <h2 className="text-lg mt-2 mr-6">Job Number: {jobNumber}</h2>
          )}
          <button
            onClick={handleToggleDarkMode}
            className={`py-2 px-4 rounded ${
              darkMode ? "bg-gray-700" : "bg-gray-200 text-gray-900"
            } focus:outline-none`}
          >
            <FontAwesomeIcon icon={darkMode ? faSun : faMoon} />
          </button>
        </div>
      </header>

      <main
        className={`flex-grow p-8 ${
          darkMode ? "bg-custom-dark" : "bg-gray-100"
        }`}
      >
        {errorMessage && (
          <div
            className={`mb-4 p-4 border rounded ${
              darkMode
                ? "bg-gray-700 border-gray-600 text-red-300"
                : "bg-red-100 text-red-700 border-red-400"
            }`}
          >
            {errorMessage}
          </div>
        )}

        {isJsonUploaded ? (
          <div className={`${darkMode ? "text-gray-50" : "text-gray-800"}`}>
            {/* Display pole stats */}
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-2">Job Stats:</h3>
              <p>Total Poles/Locations: {jobStats.totalPoles}</p>
              <p>APC Worked Poles: {jobStats.apcWorkedPoles}</p>
              <p>Midspan Poles: {jobStats.midspanPoles}</p>
              <p>APC Non-PCO Work Locations: {jobStats.apcNonPco}</p>
              <p>Poles Changed Out: {jobStats.changedOutPoles}</p>
            </div>
            <h3 className="text-lg font-semibold mb-4">Job Data:</h3>

            {isJsonUploaded && (
              <button
                onClick={handleToggleHideNoWork}
                className={`mb-4 py-2 px-4 rounded ${
                  darkMode ? "bg-gray-700" : "bg-gray-200 text-gray-900"
                } focus:outline-none`}
              >
                {hideNoWork
                  ? "Show No Work Locations"
                  : "Hide No Work Locations"}
              </button>
            )}

            <div
              className={`rounded p-4 ${
                darkMode ? "bg-custom-dark" : "bg-white border border-gray-300"
              }`}
            >
              <div className="grid gap-4">
                {parsedData
                  .filter(
                    (item) =>
                      !hideNoWork || item.constructionNotes !== "NO APC WORK",
                  )
                  .map((item, index) => (
                    <div
                      key={index}
                      className={`p-2 rounded ${
                        darkMode
                          ? "bg-custom-light"
                          : "bg-gray-50 border-b border-gray-200"
                      }`}
                    >
                      <div
                        className={`p-2 rounded ${
                          darkMode
                            ? "bg-custom-light"
                            : "bg-gray-50 border-b border-gray-200"
                        } grid grid-cols-9 gap-4`}
                      >
                        <p className="col-span-2">
                          <strong>Loc Number:</strong> {item.poleCount}
                        </p>
                        <p className="col-span-2">
                          <strong>Pole Tag:</strong> {item.poleTag}
                        </p>
                        <p className="col-span-3">
                          <strong>APC Directive:</strong> <br></br>
                          {item.constructionNotes
                            .split("\n")
                            .map((line, lineIndex) => (
                              <React.Fragment key={lineIndex}>
                                {line}
                                <br />
                              </React.Fragment>
                            ))}
                        </p>
                        <div className="col-span-2 flex flex-col items-center">
                          <p>
                            <strong>Callouts:</strong>
                          </p>
                          <button
                            onClick={() =>
                              handleCopy(
                                "LOC " +
                                  item.poleCount +
                                  "- POLE TAG# " +
                                  item.poleTag +
                                  "\n \n" +
                                  item.constructionNotesFormatted,
                                index,
                              )
                            }
                            className={`py-2 my-auto px-12 rounded bg-slate-500 text-white hover:bg-slate-700 focus:outline-none`}
                          >
                            {copiedIndex === index ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ) : excelOutput ? (
          parsedExcelData.length > 0 && (
            <div className={`${darkMode ? "text-gray-50" : "text-gray-800"}`}>
              {excelJobSummary && !isGPC && (
                <ExcelJobSummaryDisplay summary={excelJobSummary} />
              )}
              <h3 className="text-lg font-semibold mb-4">Excel Callouts:</h3>
              {/* <button
                onClick={handleDownloadPDF}
                className={`mb-4 py-2 px-4 rounded bg-slate-600 text-white hover:bg-slate-700 focus:outline-none`}
              >
                Download Callouts
              </button> */}
              <div className="grid gap-4">
                {parsedExcelData.map((item, index) => (
                  <div
                    key={index}
                    className={`p-2 rounded ${
                      darkMode
                        ? "bg-custom-light"
                        : "bg-gray-50 border-b border-gray-200"
                    }`}
                  >
                    <div
                      className={`p-2 rounded ${
                        darkMode
                          ? "bg-custom-light"
                          : "bg-gray-50 border-b border-gray-200"
                      } grid grid-cols-9 gap-4`}
                    >
                      <div className="col-span-2">
                        <p>
                          <strong>{isGPC ? "WL" : "Loc Number"}:</strong>{" "}
                          {item.poleCount}
                        </p>
                        {item.gText?.trim() && (
                          <div>
                            <p className="mt-6 text-sm">Note To Crew:</p>
                            <div
                              onClick={() =>
                                handleToCrewCopy(item.gText, index)
                              }
                              className={`mt-2 flex items-center justify-center px-3 py-2 rounded cursor-pointer select-text
        ${darkMode ? "bg-custom-light text-white" : "bg-gray-100 text-gray-900"}
        border border-gray-700 hover:border-gray-300`}
                            >
                              {copiedToCrewIndex === index
                                ? "Copied!"
                                : item.gText.toUpperCase()}
                            </div>
                          </div>
                        )}
                        {item.hText?.trim() && (
                          <div>
                            <p className="mt-6 text-sm">Notes about location:</p>
                            <div
                              className={`mt-2 flex items-center justify-center px-3 py-2 rounded cursor-pointer select-text
        ${darkMode ? "bg-custom-light text-white" : "bg-gray-100 text-gray-900"}
        border border-gray-700 hover:border-gray-300`}
                            >
                              {item.hText}

                            </div>
                          </div>
                        )}
                      </div>
                      <p className="col-span-2"></p>
                      <p className="col-span-3 whitespace-pre-wrap font-[Arial]">
                        <strong>Callouts:</strong> <br />
                        {(
                          (isGPC
                            ? `WL ${item.poleCount}${
                                item.poleTag.trim() ? `\n${item.poleTag}` : ""
                              }\n\n`
                            : `LOC ${item.poleCount}${
                                item.poleTag.trim() ? ` - ${item.poleTag}` : ""
                              }\n\n`) + item.constructionNotesFormatted
                        )
                          .split("\n")
                          .map((line, i) => (
                            <React.Fragment key={i}>
                              {line}
                              <br />
                            </React.Fragment>
                          ))}
                      </p>
                      <div className="col-span-2 flex flex-col items-center">
                        <button
                          onClick={() =>
                            handleCopy(
                              `${
                                isGPC
                                  ? `WL ${item.poleCount}${
                                      item.poleTag.trim()
                                        ? `\n${item.poleTag}`
                                        : ""
                                    }\n\n`
                                  : `LOC ${item.poleCount}${
                                      item.poleTag.trim()
                                        ? ` - ${item.poleTag}`
                                        : ""
                                    }\n\n`
                              }${item.constructionNotesFormatted}`,
                              index,
                            )
                          }
                          className={`py-2 my-auto px-12 rounded bg-slate-500 text-white hover:bg-slate-700 focus:outline-none`}
                        >
                          {copiedIndex === index ? "Copied!" : "Copy"}
                        </button>
                        {item.njunsNumber?.trim() && (
                          <button
                            onClick={() =>
                              handleNjunsCopy(
                                `NJUNS# ${item.njunsNumber.trim()}`,
                                index,
                              )
                            }
                            className="py-2 px-12 rounded bg-slate-600 text-white hover:bg-slate-700 focus:outline-none"
                          >
                            {copiedNjunsIndex === index ? "Copied!" : "NJUNS#"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) =>
              handleDrop(
                e,
                setParsedData,
                setIsJsonUploaded,
                setErrorMessage,
                setJobNumber,
                setExcelOutput,
                setParsedExcelData,
              )
            }
            className={`w-full h-48 border-4 border-dashed ${
              darkMode
                ? "border-gray-700 bg-custom-light"
                : "border-gray-950 bg-white"
            } flex items-center justify-center text-center cursor-pointer hover:border-gray-500 transition duration-300`}
          >
            Drop your JSON or XLSX file here
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
