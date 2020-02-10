const { Document, Packer, Paragraph, TextRun, Numbering, Indent, Table } = require('docx');
const { get, pickBy, mapValues } = require('lodash');

module.exports = project => {
  const pack = document => {
    const packer = new Packer();
    return packer.toBuffer(document);
  };

  const numbering = new Numbering();
  const abstract = numbering.createAbstractNumbering();

  const stripInvalidXmlChars = text => {
    if (typeof text !== 'string') {
      return text;
    }
    // eslint-disable-next-line no-control-regex
    return text.replace(/([^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFC\u{10000}-\u{10FFFF}])/ug, '');
  };

  const renderDuration = (doc, value) => {
    if (!value) {
      return;
    }
    let years = value.years === 1 ? 'Year' : 'Years';
    let months = value.months === 1 ? 'Month' : 'Months';
    doc.createParagraph(`${value.years} ${years} ${value.months} ${months}`).style('body');
  };

  const renderTextEditor = (doc, value) => {
    const content = JSON.parse(value || '{}');
    const nodes = get(content, 'document.nodes', []);
    nodes.forEach(node => {
      renderNode(doc, node);
    });
  };

  const tableToMatrix = table => {
    const rows = table.nodes;
    let rowspans = [];
    let colcount = 0;

    // calculate the actual dimensions of the table
    rows.forEach((row, rowIndex) => {
      const cells = row.nodes;
      const columnsInRow = cells
        .slice(0, -1)
        .map(cell => parseInt(get(cell, 'data.colSpan', 1), 10) || 1)
        .reduce((sum, num) => sum + num, 1);

      colcount = Math.max(colcount, columnsInRow + rowspans.length);

      // reduce rowspans by one for next row.
      rowspans = [
        ...rowspans,
        ...cells.map(cell => {
          const rs = parseInt(get(cell, 'data.rowSpan', 1), 10);
          // All falsy values _except_ 0 should be 1
          // rowspan === 0 => fill the rest of the table
          return rs || (rs === 0 ? rows.length - rowIndex : 1);
        })
      ]
        .map(s => s - 1)
        .filter(Boolean);
    });

    const matrix = Array(rows.length).fill().map(() => Array(colcount).fill(undefined));

    let rowspanStore = {};
    rows.forEach((row, rowIndex) => {
      let spanOffset = 0;
      row.nodes.forEach((cell, colIndex) => {
        colIndex += spanOffset;
        // increase index and offset if previous row rowspan is active for col
        while (get(rowspanStore, colIndex, 0)) {
          spanOffset += 1;
          colIndex += 1;
        }

        // store rowspan to be taken into account in the next row
        const rs = parseInt(get(cell, 'data.rowSpan', 1), 10);
        const cs = parseInt(get(cell, 'data.colSpan', 1), 10);
        rowspanStore[colIndex] = rs || (rs === 0 ? rows.length - rowIndex : 1);
        const colspan = cs || (cs === 0 ? colcount - colIndex : 1);

        // increase offset for next cell
        spanOffset += (colspan - 1);

        // store in correct position
        matrix[rowIndex][colIndex] = cell;
      });

      // reduce rowspans by one for next row.
      rowspanStore = pickBy(mapValues(rowspanStore, s => s - 1), Boolean);
    });

    return matrix;
  };

  const populateTable = (matrix, table) => {
    matrix.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (cell) {
          renderNode(table.getCell(rowIndex, colIndex), cell);
        }
      });
    });
  };

  const mergeCells = (matrix, table) => {
    populateTable(matrix, table);
    // merge rows
    matrix.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const rowSpan = parseInt(get(cell, 'data.rowSpan'), 10);
        if (rowSpan) {
          table.getColumn(colIndex).mergeCells(rowIndex, rowIndex + rowSpan - 1);
        }
      });
    });
    // merge cols
    matrix.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const colSpan = parseInt(get(cell, 'data.colSpan'), 10);
        if (colSpan) {
          table.getRow(rowIndex).mergeCells(colIndex, colIndex + colSpan - 1);
        }
      });
    });
  };

  const initTable = matrix => {
    const rowcount = matrix.length;
    const colcount = matrix[0].length;

    return new Table({
      rows: rowcount,
      columns: colcount,
      // setting to a large number enforces equal-width columns
      columnWidths: Array(colcount).fill('10000')
    });
  };

  const renderTable = (doc, node) => {
    const matrix = tableToMatrix(node);
    let table = initTable(matrix);

    try {
      mergeCells(matrix, table);
    } catch (err) {
      console.log('Failed to merge cells', err);
      table = initTable(matrix);
      populateTable(matrix, table);
    }

    doc.addTable(table);
  };

  const renderNode = (doc, node, depth = 0, paragraph) => {
    let text;

    const getContent = input => {
      return get(input, 'nodes[0].leaves[0].text', get(input, 'nodes[0].text')).trim();
    };

    const renderListItem = (doc, item, numbering) => {
      if (item.type !== 'list-item') {
        return renderNode(doc, item);
      }

      paragraph = paragraph = new Paragraph();
      paragraph.style('body');

      numbering
        ? paragraph.setNumbering(numbering, depth)
        : paragraph.bullet();

      item.nodes.forEach(n => renderNode(doc, n, depth + 1, paragraph));
    };

    switch (node.type) {
      case 'heading-one':
        doc.createParagraph(getContent(node)).heading1();
        break;

      case 'heading-two':
        doc.createParagraph(getContent(node)).heading2();
        break;

      case 'block-quote':
        doc.createParagraph(getContent(node)).style('aside');
        break;

      case 'table-cell':
        node.nodes.forEach(part => renderNode(doc, part));
        break;

      case 'table':
        renderTable(doc, node);
        break;

      case 'numbered-list': {
        abstract.createLevel(depth, 'decimal', '%2.', 'start').addParagraphProperty(new Indent(720 * (depth + 1), 0));
        const concrete = numbering.createConcreteNumbering(abstract);
        node.nodes.forEach(item => renderListItem(doc, item, concrete));
        break;
      }

      case 'bulleted-list':
        node.nodes.forEach(item => renderListItem(doc, item));
        break;

      case 'paragraph':
      case 'block':
        paragraph = paragraph || new Paragraph();
        node.nodes.forEach(childNode => {
          const leaves = childNode.leaves || [childNode];
          leaves.forEach(leaf => {
            text = new TextRun(stripInvalidXmlChars(leaf.text));
            if (text) {
              (leaf.marks || []).forEach(mark => {
                switch (mark.type) {
                  case 'bold':
                    text.bold();
                    break;

                  case 'italic':
                    text.italics();
                    break;

                  case 'underlined':
                    text.underline();
                    break;

                  case 'subscript':
                    text.subScript();
                    break;

                  case 'superscript':
                    text.superScript();
                    break;
                }
              });
              paragraph.style('body');
              paragraph.addRun(text);
            }
          });
        });
        doc.addParagraph(paragraph);
        break;

      case 'image':
        doc.createImage(node.data.src, node.data.width, node.data.height);
        break;

      default:
        // if there is no matching type then it's probably a denormalised text node with no wrapping paragraph
        // attempt to render with the node wrapped in a paragraph
        if (node.text) {
          renderNode(doc, { object: 'block', type: 'paragraph', nodes: [ node ] }, depth, paragraph);
        }

    }
  };

  const hasPurpose = (project, purpose) => {
    let hasPurpose;
    if (purpose === 'b') {
      hasPurpose = project.data['purpose-b'] && project.data['purpose-b'].length;
    } else {
      hasPurpose = (project.data.purpose || []).includes(`purpose-${purpose}`);
    }
    return hasPurpose ? 'X' : ' ';
  };

  const addStyles = doc => {
    doc.Styles.createParagraphStyle('Heading1', 'Heading 1')
      .basedOn('Normal')
      .next('Normal')
      .quickFormat()
      .size(36)
      .bold()
      .font('Helvetica')
      .spacing({ before: 360, after: 400 });

    doc.Styles.createParagraphStyle('Heading2', 'Heading 2')
      .basedOn('Normal')
      .next('Normal')
      .quickFormat()
      .size(24)
      .bold()
      .font('Helvetica')
      .spacing({ before: 200, after: 200 });

    doc.Styles.createParagraphStyle('Heading3', 'Heading 3')
      .basedOn('Normal')
      .next('Normal')
      .quickFormat()
      .size(28)
      .bold()
      .font('Helvetica')
      .spacing({ before: 400, after: 200 });

    doc.Styles.createParagraphStyle('body', 'Body')
      .basedOn('Normal')
      .next('Normal')
      .quickFormat()
      .size(24)
      .font('Helvetica')
      .spacing({ before: 200, after: 200 });

    doc.Styles.createParagraphStyle('ListParagraph', 'List Paragraph')
      .basedOn('Normal')
      .next('Normal')
      .quickFormat()
      .size(24)
      .font('Helvetica')
      .spacing({ before: 100, after: 100 });

    doc.Styles.createParagraphStyle('aside', 'Aside')
      .basedOn('Body')
      .next('Body')
      .quickFormat()
      .size(24)
      .color('999999')
      .italics();
  };

  return Promise.resolve()
    .then(() => new Document())
    .then(doc => {

      addStyles(doc);

      const table = new Table({
        rows: 19,
        columns: 3,
        // setting to a large number enforces equal-width columns
        columnWidths: ['10000', '10000', '10000']
      });

      table.getRow(0).mergeCells(1, 2);
      table.getRow(1).mergeCells(1, 2);
      table.getRow(2).mergeCells(1, 2);
      table.getColumn(0).mergeCells(3, 10);
      table.getRow(11).mergeCells(1, 2);
      table.getRow(12).mergeCells(1, 2);
      table.getRow(13).mergeCells(1, 2);
      table.getRow(14).mergeCells(1, 2);
      table.getRow(15).mergeCells(1, 2);
      table.getRow(16).mergeCells(1, 2);
      table.getRow(17).mergeCells(1, 2);
      table.getRow(18).mergeCells(1, 2);

      table.getCell(0, 0).addParagraph(new Paragraph('Project').style('Heading2'));
      table.getCell(0, 1).addParagraph(new Paragraph(project.project.title).style('Heading2'));

      table.getCell(1, 0).addParagraph(new Paragraph('Key Words (max. 5 words)').style('body'));

      table.getCell(2, 0).addParagraph(new Paragraph('Expected duration of the project (yrs)').style('body'));
      renderDuration(table.getCell(2, 1), project.data.duration);

      table.getCell(3, 0).addParagraph(new Paragraph('Purpose of the project as in ASPA section 5C(3) (Mark all boxes that apply)').style('body'));

      table.getCell(3, 1).addParagraph(new Paragraph(hasPurpose(project, 'a')).style('body'));
      table.getCell(3, 2).addParagraph(new Paragraph('Basic research').style('body'));
      table.getCell(4, 1).addParagraph(new Paragraph(hasPurpose(project, 'b')).style('body'));
      table.getCell(4, 2).addParagraph(new Paragraph('Translational and applied research').style('body'));
      table.getCell(5, 1).addParagraph(new Paragraph(hasPurpose(project, 'c')).style('body'));
      table.getCell(5, 2).addParagraph(new Paragraph('Regulatory use and routine production').style('body'));
      table.getCell(6, 1).addParagraph(new Paragraph(hasPurpose(project, 'd')).style('body'));
      table.getCell(6, 2).addParagraph(new Paragraph('Protection of the natural environment in the interests of the health or welfare of humans or animals').style('body'));
      table.getCell(7, 1).addParagraph(new Paragraph(hasPurpose(project, 'e')).style('body'));
      table.getCell(7, 2).addParagraph(new Paragraph('Preservation of species').style('body'));
      table.getCell(8, 1).addParagraph(new Paragraph(hasPurpose(project, 'f')).style('body'));
      table.getCell(8, 2).addParagraph(new Paragraph('Higher education or training').style('body'));
      table.getCell(9, 1).addParagraph(new Paragraph(hasPurpose(project, 'g')).style('body'));
      table.getCell(9, 2).addParagraph(new Paragraph('Forensic enquiries').style('body'));
      table.getCell(10, 1).addParagraph(new Paragraph(' ').style('body'));
      table.getCell(10, 2).addParagraph(new Paragraph('Maintenance of colonies of genetically altered animals').style('body'));

      table.getCell(11, 0).addParagraph(new Paragraph('Describe the objectives of the project (e.g. the scientific unknowns or scientific/clinical needs being addressed)').style('body'));
      renderTextEditor(table.getCell(11, 1), project.data['nts-objectives']);

      table.getCell(12, 0).addParagraph(new Paragraph('What are the potential benefits likely to derive from this project (how science could be advanced or humans or animals could benefit from the project)?').style('body'));
      renderTextEditor(table.getCell(12, 1), project.data['nts-benefits']);

      table.getCell(13, 0).addParagraph(new Paragraph('What species and approximate numbers of animals do you expect to use over what period of time?').style('body'));
      renderTextEditor(table.getCell(13, 1), project.data['nts-numbers']);

      table.getCell(14, 0).addParagraph(new Paragraph('In the context of what you propose to do to the animals, what are the expected adverse effects and the likely/expected level of severity? What will happen to the animals at the end?').style('body'));
      renderTextEditor(table.getCell(14, 1), project.data['nts-adverse-effects']);

      table.getCell(15, 0).addParagraph(new Paragraph('Application of the 3Rs').style('body'));

      table.getCell(16, 0)
        .addParagraph(new Paragraph('1. Replacement').style('Heading2'))
        .addParagraph(new Paragraph('State why you need to use animals and why you cannot use non-animal alternatives').style('body'));
      renderTextEditor(table.getCell(16, 1), project.data['nts-replacement']);

      table.getCell(17, 0)
        .addParagraph(new Paragraph('2. Reduction').style('Heading2'))
        .addParagraph(new Paragraph('Explain how you will assure the use of minimum numbers of animals').style('body'));
      renderTextEditor(table.getCell(17, 1), project.data['nts-reduction']);

      table.getCell(18, 0)
        .addParagraph(new Paragraph('3. Refinement').style('Heading2'))
        .addParagraph(new Paragraph('Explain the choice of species and why the animal model(s) you will use are the most refined, having regard to the objectives. Explain the general measures you will take to minimise welfare costs (harms) to the animals.').style('body'));
      renderTextEditor(table.getCell(18, 1), project.data['nts-refinement']);

      doc.addTable(table);

      return pack(doc);
    });

};