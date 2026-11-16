/* a file's text, as the test runner hands it over: the tests read the skill's
   copy of the source this way, with no Node types to bring in */
declare module '*?raw' {
	const text: string
	export default text
}
