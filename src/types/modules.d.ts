declare module 'html-to-pdfmake' {
  const htmlToPdfmake: (
    html: string,
    options?: Record<string, unknown>,
  ) => unknown;
  export default htmlToPdfmake;
}

declare module 'pdfmake/build/pdfmake' {
  interface PdfMakeStatic {
    vfs: Record<string, string>;
    createPdf(docDefinition: Record<string, unknown>): {
      download(filename: string, cb?: () => void): void;
    };
  }
  const pdfMake: PdfMakeStatic & { default?: PdfMakeStatic };
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  const vfsFonts: {
    pdfMake?: { vfs: Record<string, string> };
    default?: { pdfMake?: { vfs: Record<string, string> } };
  };
  export default vfsFonts;
}
