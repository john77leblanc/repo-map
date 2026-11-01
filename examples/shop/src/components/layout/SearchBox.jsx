export default function SearchBox() {
    function handleSubmit(event) {
        event.preventDefault();
        const query = new FormData(event.target).get('q');
        window.location.assign(`/?q=${encodeURIComponent(query)}`);
    }

    return (
        <form role="search" onSubmit={handleSubmit}>
            <input name="q" type="search" placeholder="Search products" />
        </form>
    );
}
